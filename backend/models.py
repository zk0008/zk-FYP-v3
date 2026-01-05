from sqlalchemy import Column, Integer, String, ForeignKey, Boolean, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False)  # Values: "student", "supervisor", "coordinator"
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    group_memberships = relationship("GroupMember", back_populates="user")
    messages = relationship("Message", back_populates="user")


class Group(Base):
    __tablename__ = "groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False, index=True)
    string_id = Column(String, unique=True, nullable=False, index=True)  # "group-a", "group-b", etc.
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    members = relationship("GroupMember", back_populates="group")
    messages = relationship("Message", back_populates="group")
    documents = relationship("Document", back_populates="group")


class GroupMember(Base):
    __tablename__ = "group_members"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    role_in_group = Column(String, nullable=True)  # Optional role within the group
    joined_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    user = relationship("User", back_populates="group_memberships")
    group = relationship("Group", back_populates="members")


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # Nullable for AI messages
    content = Column(String, nullable=False)
    is_AI = Column(Boolean, default=False, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    group = relationship("Group", back_populates="messages")
    user = relationship("User", back_populates="messages")


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(String, ForeignKey("groups.string_id"), nullable=False)
    uploaded_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    filename = Column(String, nullable=False)
    stored_path = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    group = relationship("Group", back_populates="documents")
    uploaded_by = relationship("User")

