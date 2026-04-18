import os
import chromadb
from openai import OpenAI

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

# ChromaDB writes to chroma_store/ next to this file, persists across restarts
_chroma = chromadb.PersistentClient(path="chroma_store")


def chunk_text(text, chunk_size=500, overlap=100):
    # Split on whitespace, then slide a window of chunk_size words
    # with a 100-word overlap so nothing important falls between chunks
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
    return _chroma.get_or_create_collection(
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


def index_document(group_id, filename, text):
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

    ids = [f"{filename}::{i}" for i in range(len(chunks))]
    metadatas = [{"filename": filename, "chunk_index": i} for i in range(len(chunks))]

    collection.add(
        ids=ids,
        embeddings=embeddings,
        documents=chunks,
        metadatas=metadatas
    )


def get_relevant_context(group_id, query, top_k=40, top_n=10):
    # Returns (chunks, top_score) where chunks is a list of
    # {text, filename, chunk_index, score} dicts and top_score is the best
    # cross-encoder score — the caller uses it for the threshold check.
    # Returns ([], -999.0) when there are no indexed docs for this group.
    collection = _get_collection(group_id)

    if collection.count() == 0:
        return [], -999.0

    query_embedding = _embed([query])[0]

    # Cap n_results at collection size to avoid a ChromaDB error
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=min(top_k, collection.count()),
        include=["documents", "metadatas"]
    )

    candidate_texts = results["documents"][0]
    candidate_metas = results["metadatas"][0]

    if not candidate_texts:
        return [], -999.0

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
