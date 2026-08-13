import os

# Configuration variables loaded from environment variables
MODE: str = os.getenv("MODE", "MOCK")  # "MOCK" or "LIVE_GCP"
GCP_PROJECT: str = os.getenv("GCP_PROJECT", "")
GCP_LOCATION: str = os.getenv(
    "GCP_LOCATION", "asia-south1"
)  # "asia-south1" or "global"
GEMINI_MODEL: str = os.getenv(
    "GEMINI_MODEL", "gemini-2.5-pro"
)  # "gemini-2.5-pro" or "gemini-3.5-flash"
PORT: int = int(os.getenv("PORT", "8126"))
