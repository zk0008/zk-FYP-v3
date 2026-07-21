import os
from azure.storage.blob import BlobServiceClient
from azure.core.exceptions import ResourceNotFoundError

# cached client — created once on first use so we don't reconnect on every request
_client = None


def is_blob_storage_enabled():
    return bool(os.getenv("AZURE_STORAGE_CONNECTION_STRING"))


def get_blob_service_client():
    global _client
    if _client is None:
        _client = BlobServiceClient.from_connection_string(
            os.getenv("AZURE_STORAGE_CONNECTION_STRING")
        )
    return _client


def upload_blob(container_name, blob_name, content_bytes):
    client = get_blob_service_client()
    blob = client.get_blob_client(container=container_name, blob=blob_name)
    blob.upload_blob(content_bytes, overwrite=True)


def download_blob(container_name, blob_name):
    client = get_blob_service_client()
    blob = client.get_blob_client(container=container_name, blob=blob_name)
    try:
        return blob.download_blob().readall()
    except ResourceNotFoundError:
        raise FileNotFoundError(f"Blob not found: {container_name}/{blob_name}")


def delete_blob(container_name, blob_name):
    client = get_blob_service_client()
    blob = client.get_blob_client(container=container_name, blob=blob_name)
    try:
        blob.delete_blob()
    except ResourceNotFoundError:
        pass  # already gone — nothing to do


def blob_exists(container_name, blob_name):
    client = get_blob_service_client()
    blob = client.get_blob_client(container=container_name, blob=blob_name)
    return blob.exists()
