import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Read DATABASE_URL from environment
DATABASE_URL = os.getenv("DATABASE_URL")

# If DATABASE_URL is not set, use a default SQLite database for development
if not DATABASE_URL:
    DATABASE_URL = "sqlite:///./app.db"
    print("WARNING: DATABASE_URL not set. Using SQLite database: app.db")

# Create SQLAlchemy engine.
# SQLite gets NullPool — no connection pooling, each SessionLocal() opens its own
# connection directly. This prevents pool exhaustion from long-lived WebSocket sessions
# that each hold a connection open for the lifetime of the socket.
if "sqlite" in DATABASE_URL:
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=NullPool,
    )
else:
    engine = create_engine(DATABASE_URL)

# Create SessionLocal class
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create Base class for declarative models
Base = declarative_base()


def get_db():
    """
    Dependency function that yields a database session.
    Use this in FastAPI endpoints with: db: Session = Depends(get_db)
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

