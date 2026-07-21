import os
from openai import OpenAI
from database import engine, SessionLocal
import models

# Load the cross-encoder once at startup.
# First run downloads ~90MB of model weights, cached locally after that.
try:
    from sentence_transformers import CrossEncoder
    reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
except ImportError:
    reranker = None
    print("WARNING: sentence-transformers not installed. Reranking disabled.")

# Separate OpenAI client just for embeddings
_openai_api_key = os.getenv("OPENAI_API_KEY")
_embed_client = OpenAI(api_key=_openai_api_key) if _openai_api_key else None

# None until first use — deferred so chromadb is never imported on PostgreSQL backends
# (chromadb checks sqlite3 version at import time, which crashes on Azure's OS-level sqlite3)
_chroma = None


def _get_chroma_client():
    global _chroma
    if _chroma is None:
        import chromadb
        _chroma = chromadb.PersistentClient(path="chroma_store")
    return _chroma


def is_postgres_backend():
    return engine.dialect.name == "postgresql"


def chunk_text(text, chunk_size=200, overlap=50):
    # Split on whitespace, then slide a window of chunk_size words
    # with a 50-word overlap so nothing important falls between chunks
    words = text.split()
    chunks = []
    start = 0
    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunk = " ".join(words[start:end])
        if chunk.strip():
            chunks.append(chunk)
        if end == len(words):
            break
        start += chunk_size - overlap
    return chunks


def _get_collection(group_id):
    # group_id is already "group-a" style — valid as a ChromaDB collection name
    return _get_chroma_client().get_or_create_collection(
        name=group_id,
        metadata={"hnsw:space": "cosine"}
    )


def _embed(texts):
    if not _embed_client:
        raise RuntimeError("OPENAI_API_KEY not set — can't create embeddings")
    response = _embed_client.embeddings.create(
        model="text-embedding-3-small",
        input=texts
    )
    return [item.embedding for item in response.data]


def index_document(group_id, filename, text, original_filename=None):
    if is_postgres_backend():
        db = SessionLocal()
        try:
            # wipe any old chunks for this filename so re-uploads don't double-index
            db.query(models.Chunk).filter(
                models.Chunk.group_string_id == group_id,
                models.Chunk.filename == filename
            ).delete()
            db.commit()
            chunks = chunk_text(text)
            if not chunks:
                return
            embeddings = _embed(chunks)
            display_name = original_filename if original_filename else filename
            for i, (chunk, emb) in enumerate(zip(chunks, embeddings)):
                db.add(models.Chunk(
                    group_string_id=group_id,
                    filename=filename,
                    original_filename=display_name,
                    chunk_index=i,
                    chunk_text=chunk,
                    embedding=emb
                ))
            db.commit()
        finally:
            db.close()
    else:
        # Wipe any old chunks for this filename first so re-uploads don't double-index
        collection = _get_collection(group_id)
        existing = collection.get(where={"filename": filename})
        if existing["ids"]:
            collection.delete(ids=existing["ids"])

        chunks = chunk_text(text)
        if not chunks:
            return

        # Embed everything in one API call — cheaper than one call per chunk
        embeddings = _embed(chunks)

        # original_filename is what the user called the file before we timestamped it.
        # Store it so filename detection can match "report.pdf" in a query even though
        # the safe key is "20240622_143021_report.pdf".
        display_name = original_filename if original_filename else filename
        ids = [f"{filename}::{i}" for i in range(len(chunks))]
        metadatas = [
            {"filename": filename, "chunk_index": i, "original_filename": display_name}
            for i in range(len(chunks))
        ]

        collection.add(
            ids=ids,
            embeddings=embeddings,
            documents=chunks,
            metadatas=metadatas
        )


def get_relevant_context(group_id, query, top_k=80, top_n=10):
    # Returns (chunks, top_score) where chunks is a list of
    # {text, filename, chunk_index, score} dicts and top_score is the best
    # cross-encoder score — the caller uses it for the threshold check.
    # Returns ([], -999.0) when there are no indexed docs for this group.
    if is_postgres_backend():
        db = SessionLocal()
        try:
            if not db.query(models.Chunk).filter(
                models.Chunk.group_string_id == group_id
            ).first():
                return [], -999.0

            query_embedding = _embed([query])[0]

            # filter and order in one pass — pgvector computes cosine distance in SQL
            candidates = (
                db.query(models.Chunk)
                .filter(models.Chunk.group_string_id == group_id)
                .filter(models.Chunk.embedding.cosine_distance(query_embedding) <= 0.8)
                .order_by(models.Chunk.embedding.cosine_distance(query_embedding))
                .limit(top_k)
                .all()
            )

            if not candidates:
                return [], -999.0

            # Cross-encoder reranks the vector-search candidates — same logic as ChromaDB path
            if reranker:
                pairs = [(query, row.chunk_text) for row in candidates]
                scores = reranker.predict(pairs).tolist()
            else:
                scores = [1.0 - (i * 0.1) for i in range(len(candidates))]

            ranked = sorted(
                zip(scores, candidates),
                key=lambda x: x[0],
                reverse=True
            )[:top_n]

            top_score = ranked[0][0]
            print(f"[RAG] Top reranker score for query: {top_score:.4f}")
            chunks = [
                {
                    "text": row.chunk_text,
                    "filename": row.filename,
                    "chunk_index": row.chunk_index,
                    "score": score
                }
                for score, row in ranked
            ]
            return chunks, top_score
        finally:
            db.close()
    else:
        collection = _get_collection(group_id)

        if collection.count() == 0:
            return [], -999.0

        query_embedding = _embed([query])[0]

        # Cap n_results at collection size to avoid a ChromaDB error
        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=min(top_k, collection.count()),
            include=["documents", "metadatas", "distances"]
        )

        candidate_texts = results["documents"][0]
        candidate_metas = results["metadatas"][0]
        candidate_distances = results["distances"][0]

        if not candidate_texts:
            return [], -999.0

        # Drop anything with cosine distance > 0.8 (similarity < 0.2) — not worth reranking.
        # ChromaDB cosine distance = 1 - cosine_similarity, so 0.8 distance = 0.2 similarity.
        filtered = [
            (text, meta)
            for text, meta, dist in zip(candidate_texts, candidate_metas, candidate_distances)
            if dist <= 0.8
        ]
        if not filtered:
            return [], -999.0
        candidate_texts = [item[0] for item in filtered]
        candidate_metas = [item[1] for item in filtered]

        # Cross-encoder scores each (query, passage) pair — much more precise than cosine distance
        if reranker:
            pairs = [(query, text) for text in candidate_texts]
            scores = reranker.predict(pairs).tolist()
        else:
            # Fallback if sentence-transformers isn't installed: preserve vector-search order
            scores = [1.0 - (i * 0.1) for i in range(len(candidate_texts))]

        ranked = sorted(
            zip(scores, candidate_texts, candidate_metas),
            key=lambda x: x[0],
            reverse=True
        )[:top_n]

        top_score = ranked[0][0]
        print(f"[RAG] Top reranker score for query: {top_score:.4f}")
        chunks = [
            {
                "text": text,
                "filename": meta["filename"],
                "chunk_index": int(meta["chunk_index"]),
                "score": score
            }
            for score, text, meta in ranked
        ]

        return chunks, top_score


def get_top_document(chunks):
    # Given the top-N ranked chunks (each with a "score"), figure out which
    # document contributed the highest-scoring chunks on average.
    # This is the document we fall back to for full-text retrieval in Case 2.
    # Pure Python — operates on the already-fetched chunks list, no DB access needed.
    scores_by_file = {}
    for chunk in chunks:
        fname = chunk["filename"]
        if fname not in scores_by_file:
            scores_by_file[fname] = []
        scores_by_file[fname].append(chunk["score"])

    avg_scores = {
        fname: sum(s) / len(s)
        for fname, s in scores_by_file.items()
    }

    return max(avg_scores, key=avg_scores.get)


def get_top_chunks_for_document(group_id, query, filename, top_n=5):
    # Pull every chunk for the named file then rerank them against the query.
    # Case 2 calls this instead of dumping the whole PDF — avoids token bloat
    # on long documents and still surfaces the most relevant pages.
    if is_postgres_backend():
        db = SessionLocal()
        try:
            rows = (
                db.query(models.Chunk)
                .filter(
                    models.Chunk.group_string_id == group_id,
                    models.Chunk.filename == filename
                )
                .order_by(models.Chunk.chunk_index)
                .all()
            )
            if not rows:
                return []
            texts = [row.chunk_text for row in rows]
            if reranker:
                pairs = [(query, text) for text in texts]
                scores = reranker.predict(pairs).tolist()
                ranked = sorted(zip(scores, texts), key=lambda x: x[0], reverse=True)[:top_n]
                return [text for _, text in ranked]
            else:
                return texts[:top_n]
        finally:
            db.close()
    else:
        try:
            collection = _get_collection(group_id)
        except Exception:
            return []

        if collection.count() == 0:
            return []

        result = collection.get(
            where={"filename": filename},
            include=["documents"]
        )

        if not result["ids"]:
            return []

        texts = result["documents"]
        if not texts:
            return []

        if reranker:
            pairs = [(query, text) for text in texts]
            scores = reranker.predict(pairs).tolist()
            ranked = sorted(
                zip(scores, texts),
                key=lambda x: x[0],
                reverse=True
            )[:top_n]
            return [text for _, text in ranked]
        else:
            # No reranker — return first top_n chunks in page order
            paired = sorted(
                zip(result["ids"], texts),
                key=lambda x: int(x[0].split("::")[-1])
            )
            return [text for _, text in paired[:top_n]]


def get_chunks_by_filename(group_id, filename):
    # Fetch every stored chunk for a specific file, in page order.
    # Useful when the user names a file explicitly — skip cosine search entirely.
    if is_postgres_backend():
        db = SessionLocal()
        try:
            rows = (
                db.query(models.Chunk)
                .filter(
                    models.Chunk.group_string_id == group_id,
                    models.Chunk.filename == filename
                )
                .order_by(models.Chunk.chunk_index)
                .all()
            )
            return [row.chunk_text for row in rows]
        finally:
            db.close()
    else:
        try:
            collection = _get_collection(group_id)
        except Exception:
            return []

        if collection.count() == 0:
            return []

        result = collection.get(
            where={"filename": filename},
            include=["documents"]
        )

        if not result["ids"]:
            return []

        # IDs are "{filename}::{chunk_index}" — sort by the numeric suffix
        paired = sorted(
            zip(result["ids"], result["documents"]),
            key=lambda x: int(x[0].split("::")[-1])
        )
        return [text for _, text in paired]


def list_indexed_filenames(group_id):
    # returns [{safe_filename, original_filename}] for every unique file indexed in this group
    if is_postgres_backend():
        db = SessionLocal()
        try:
            rows = (
                db.query(models.Chunk.filename, models.Chunk.original_filename)
                .filter(models.Chunk.group_string_id == group_id)
                .distinct()
                .all()
            )
            return [
                {
                    "safe_filename": row.filename,
                    "original_filename": row.original_filename or row.filename
                }
                for row in rows
            ]
        finally:
            db.close()
    else:
        try:
            collection = _get_collection(group_id)
        except Exception:
            return []

        if collection.count() == 0:
            return []

        result = collection.get(include=["metadatas"])
        seen = set()
        filenames = []
        for meta in result["metadatas"]:
            fname = meta.get("filename", "")
            if fname and fname not in seen:
                seen.add(fname)
                orig = meta.get("original_filename", fname)
                filenames.append({"safe_filename": fname, "original_filename": orig})
        return filenames
