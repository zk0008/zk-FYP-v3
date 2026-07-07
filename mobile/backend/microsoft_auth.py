import os
import jwt
import requests
from dotenv import load_dotenv

load_dotenv()

MICROSOFT_JWKS_URL = "https://login.microsoftonline.com/common/discovery/v2.0/keys"


def verify_microsoft_token(id_token: str) -> dict:
    # peek at the header without verifying so we know which signing key to fetch
    try:
        unverified_header = jwt.get_unverified_header(id_token)
    except jwt.DecodeError as e:
        raise Exception(f"Could not read token header: {e}")

    kid = unverified_header.get("kid")
    if not kid:
        raise Exception("Token header is missing 'kid' — cannot look up signing key")

    # fetch Microsoft's public keys
    try:
        resp = requests.get(MICROSOFT_JWKS_URL, timeout=10)
        resp.raise_for_status()
        jwks = resp.json()
    except Exception as e:
        raise Exception(f"Failed to fetch Microsoft JWKS: {e}")

    matching_key = None
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            matching_key = key
            break

    if not matching_key:
        raise Exception(f"No matching public key found for kid '{kid}'")

    # PyJWT's RSAAlgorithm can build a public key object straight from the JWK dict
    try:
        public_key = jwt.algorithms.RSAAlgorithm.from_jwk(matching_key)
    except Exception as e:
        raise Exception(f"Failed to build public key from JWK: {e}")

    client_id = os.getenv("MICROSOFT_CLIENT_ID")
    if not client_id:
        raise Exception("MICROSOFT_CLIENT_ID environment variable is not set")

    try:
        payload = jwt.decode(
            id_token,
            public_key,
            algorithms=["RS256"],
            audience=client_id,
        )
    except jwt.ExpiredSignatureError:
        raise Exception("Microsoft token has expired")
    except jwt.InvalidAudienceError:
        raise Exception("Token audience does not match the configured client ID")
    except jwt.InvalidTokenError as e:
        raise Exception(f"Token verification failed: {e}")

    return payload
