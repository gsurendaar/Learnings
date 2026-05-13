# main.py
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_core.documents import Document
import pandas as pd
import os

def load_and_vectorize():
    df = pd.read_csv("data/tickets.csv")
    documents = [
        Document(page_content=f"Title: {row.title}\n"
                            f"Description: {row.description}\n"
                            f"Resolution: {row.resolution}\n"
                            f"Resource Link: {row.resource_link}", metadata={"ticket_id": str(row.ticket_id),
                "title": row.title,
                "description": row.description,
                "resolution": row.resolution,
                "resource_link": row.resource_link})
        for _, row in df.iterrows()
    ]

    embedding_model = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
    vectorstore = FAISS.from_documents(documents, embedding_model)

    vectorstore.save_local("faiss_ticket_index")
    print("✅ FAISS index created and saved successfully.")
    return vectorstore

if __name__ == "__main__":
    if not os.path.exists("faiss_ticket_index"):
        load_and_vectorize()
    else:
        print("FAISS index already exists. Run 'update_index.py' to add new tickets.")
