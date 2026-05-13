# chat_app.py
import streamlit as st
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from search_similar import get_similar_tickets

# Streamlit UI
st.set_page_config(page_title="Smart Ticket Bot", page_icon="📩")

@st.cache_resource
def load_vector_store():
    embedding_model = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
    return FAISS.load_local(
        "faiss_ticket_index",
        embeddings=embedding_model,
        allow_dangerous_deserialization=True
    )


vectorstore = load_vector_store()

st.title("🎯 Smart Ticketing Assistant")

st.write("Ask your ticket issue. I’ll show you the most similar past tickets from our knowledge base.")

query = st.text_input("📝 Describe your issue:")

if query:
    with st.spinner("Searching for similar tickets..."):
        results = get_similar_tickets(query, k=3)
    print(f"{results}")
    if results:
        st.success("Here are the top similar tickets:")
        for i, doc in enumerate(results, 1):
            st.markdown(f"**{i}. Ticket ID:** {doc.metadata.get('ticket_id', 'N/A')}")
            st.markdown(f"🔍 {doc.page_content}")
            st.markdown("---")
    else:
        st.warning("No similar tickets found.")
