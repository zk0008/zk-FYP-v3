"""add student_summary to groups

Revision ID: add_student_summary
Revises: add_sources_messages
Create Date: 2025-01-06 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_student_summary'
down_revision: Union[str, None] = 'add_sources_messages'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add student_summary column to groups table."""
    op.add_column('groups', 
        sa.Column('student_summary', sa.Text(), nullable=True)
    )


def downgrade() -> None:
    """Remove student_summary column from groups table."""
    op.drop_column('groups', 'student_summary')



