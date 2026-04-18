"""add sources to messages

Revision ID: add_sources_messages
Revises: d8614f479169
Create Date: 2025-01-06 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'add_sources_messages'
down_revision: Union[str, None] = 'd8614f479169'  # Must match the revision ID of the previous migration
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add sources column to messages table."""
    # Check database type and use appropriate JSON type
    bind = op.get_bind()
    dialect_name = getattr(bind.dialect, 'name', None)
    
    if dialect_name == 'postgresql':
        # Use JSONB for PostgreSQL (more efficient than JSON)
        op.add_column('messages', 
            sa.Column('sources', 
                      postgresql.JSONB(astext_type=sa.Text()), 
                      nullable=True)
        )
    else:
        # Use JSON for SQLite and other databases
        op.add_column('messages', 
            sa.Column('sources', 
                      sa.JSON(), 
                      nullable=True)
        )


def downgrade() -> None:
    """Remove sources column from messages table."""
    op.drop_column('messages', 'sources')

