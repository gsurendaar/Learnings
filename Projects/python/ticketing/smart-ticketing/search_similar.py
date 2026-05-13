# search_similar.py
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
import os  # Add this import


def get_similar_tickets(query, k=5):
    embedding_model = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

    # Get script directory
    script_dir = os.path.dirname(os.path.abspath(__file__))

    # Define the index path relative to the script location
    index_path = os.path.join(script_dir, "faiss_ticket_index")

    print(f"Looking for index in: {index_path}")

    if not os.path.exists(index_path):
        raise FileNotFoundError(f"Index directory not found at {index_path}")

    vectorstore = FAISS.load_local(
        index_path,
        embeddings=embedding_model,
        allow_dangerous_deserialization=True
    )

    docs = vectorstore.similarity_search(query, k=k)
    return docs


if __name__ == "__main__":
    query = input("📝 Enter your ticket description: ")
    print(f"result :: {get_similar_tickets(query)}")