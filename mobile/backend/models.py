from sqlalchemy import Column, Integer, String, ForeignKey, Boolean, DateTime, Text, JSON
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
    student_summary = Column(Text, nullable=True)  # Collaborative student summary
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    members = relationship("GroupMember", back_populates="group")
    messages = relationship("Message", back_populates="group")
    documents = relationship("Document", back_populates="group")
    summaries = relationship("Summary", back_populates="group")
    student_summaries = relationship("StudentSummary", back_populates="group")


class GroupMember(Base):
    __tablename__ = "group_members"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    role_in_group = Column(String, nullable=True)  # Optional role within the group
    joined_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_read_message_id = Column(Integer, nullable=True)  # highest message id seen by this user

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
    message_type = Column(String, default="text", nullable=False)  # "text" or "image"
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    sources = Column(JSON, nullable=True)  # Array of source objects: [{"type": "document", "filename": "...", "id": ...}, ...]

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


class Summary(Base):
    __tablename__ = "summaries"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(String, ForeignKey("groups.string_id"), nullable=False)
    range_type = Column(String, nullable=False)  # "weekly", "full", etc.
    start_time = Column(DateTime, nullable=True)
    end_time = Column(DateTime, nullable=True)
    summary_text = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    source_last_message_ts = Column(DateTime, nullable=True)
    source_message_count = Column(Integer, nullable=True)

    # Relationships
    group = relationship("Group", back_populates="summaries")
    created_by = relationship("User")


class StudentSummary(Base):
    __tablename__ = "student_summaries"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(String, ForeignKey("groups.string_id"), nullable=False)
    summary_text = Column(Text, nullable=False)
    ai_summary_copy = Column(Text, nullable=True)   # snapshot of the AI summary at save time
    is_submitted = Column(Boolean, default=False, nullable=False)
    submitted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    group = relationship("Group", back_populates="student_summaries")
    created_by = relationship("User")


class Deadline(Base):
    __tablename__ = "deadlines"

    id = Column(Integer, primary_key=True, index=True)
    deadline_dt = Column(DateTime, nullable=False)
    set_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    set_by = relationship("User")


class PushToken(Base):
    __tablename__ = "push_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    # Expo push token — unique so the same token isn't stored twice
    token = Column(String, unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user = relationship("User")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    recipient_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    message_id = Column(Integer, ForeignKey("messages.id"), nullable=False)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Two FKs to the same table — foreign_keys= tells SQLAlchemy which is which
    recipient = relationship("User", foreign_keys=[recipient_id])
    sender = relationship("User", foreign_keys=[sender_id])
    message = relationship("Message")

