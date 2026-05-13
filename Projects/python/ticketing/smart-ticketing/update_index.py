# update_index.py
from langchain_community.vectorstores import FAISS
from langchain_huggingface import HuggingFaceEmbeddings
from langchain.schema import Document
import pandas as pd


def update_index(file_path):
    """Update the index with new tickets, avoiding duplicates."""
    import os

    # Get script directory for consistent paths
    script_dir = os.path.dirname(os.path.abspath(__file__))
    index_path = os.path.join(script_dir, "faiss_ticket_index")

    # Check if the file exists
    csv_path = os.path.join(script_dir, file_path)
    if not os.path.exists(csv_path):
        print(f"Error: File not found at {csv_path}")
        return None

    # Load new tickets
    print(f"Loading tickets from {csv_path}")
    df_new = pd.read_csv(csv_path)
    print(f"Found {len(df_new)} tickets in CSV")

    # Load the existing vector store
    embedding_model = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
    vectorstore = FAISS.load_local(index_path, embeddings=embedding_model,
                                   allow_dangerous_deserialization=True)

    # Get existing ticket IDs from the vector store
    existing_ids = set()
    for doc in vectorstore.docstore._dict.values():
        existing_ids.add(doc.metadata["ticket_id"])

    # Filter out documents that already exist in the vector store
    new_documents = []
    for _, row in df_new.iterrows():
        ticket_id = str(row.ticket_id)
        if ticket_id not in existing_ids:
            # Include title, description, resolution and resource link in the content
            page_content = (f"Title: {row.title}\n"
                            f"Description: {row.description}\n"
                            f"Resolution: {row.resolution}\n"
                            f"Resource Link: {row.resource_link}")

            # Store all fields in metadata for easy retrieval
            metadata = {
                "ticket_id": ticket_id,
                "title": row.title,
                "description": row.description,
                "resolution": row.resolution,
                "resource_link": row.resource_link
            }

            new_documents.append(
                Document(page_content=page_content, metadata=metadata)
            )

    # Add only new documents to the vector store
    if new_documents:
        vectorstore.add_documents(new_documents)

    vectorstore.save_local(index_path)

    print(f"✅ Index saved to {index_path}")
    return vectorstore


def list_all_tickets_in_index():
    """List all tickets stored in the FAISS vector store."""
    from langchain_community.vectorstores import FAISS
    from langchain_huggingface import HuggingFaceEmbeddings
    import os

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

    # Access the document store
    docstore = vectorstore.docstore

    # Get all documents
    all_docs = list(docstore._dict.values())

    print(f"Total tickets in index: {len(all_docs)}")

    # Create sorted list of tickets by ID
    ticket_list = []
    for doc in all_docs:
        ticket_id = doc.metadata.get("ticket_id", "Unknown")
        title = doc.metadata.get("title", "Unknown")
        try:
            ticket_list.append((int(ticket_id), title))
        except ValueError:
            ticket_list.append((999999, f"{ticket_id} - {title}"))

    # Sort by ticket ID
    ticket_list.sort()

    # Print ticket details
    for i, (ticket_id, title) in enumerate(ticket_list, 1):
        print(f"{i}. Ticket ID: {ticket_id} - Title: {title}")

    return all_docs


if __name__ == "__main__":
    list_all_tickets_in_index()
    update_index("data/new_tickets.csv")
    print("\nAfter update:")
    list_all_tickets_in_index()

#if __name__ == "__main__":
    #update_index("data/tickets.csv")
    #update_index("data/new_tickets.csv")
