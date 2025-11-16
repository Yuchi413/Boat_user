import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, scoped_session
from sqlalchemy.ext.declarative import declarative_base

def make_engine_and_session(db_path: str):
    """
    建立一個獨立的 SQLAlchemy engine、session、Base
    用來管理多個 SQLite 資料庫（非 Flask 綁定的）
    """

    # 將路徑轉為絕對路徑，避免 Flask 與 Scheduler session 不一致
    abs_path = os.path.abspath(db_path)
    db_dir = os.path.dirname(abs_path)
    os.makedirs(db_dir, exist_ok=True)

    # 建立 engine，允許多執行緒共用
    engine = create_engine(
        f"sqlite:///{abs_path}",
        connect_args={"check_same_thread": False},
        echo=False,
    )

    # 建立 scoped session（確保 Thread-Safe）
    Session = scoped_session(sessionmaker(bind=engine))

    # 宣告 Base 類別（用於資料表定義）
    Base = declarative_base()

    return engine, Session, Base
