import streamlit as st
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
import sys
import os
from pathlib import Path

# Add module paths to system path
parent_dir = Path(__file__).parent
sys.path.append(str(parent_dir / 'smart-ticketing'))
sys.path.append(str(parent_dir / 'incidenthub'))

# Import modules from both projects
from search_similar import get_similar_tickets # Adjusted import path
from incidenthub.IncidentPatternExtractor import get_or_train_model
import base64

# Page configuration
st.set_page_config(
    page_title="Banking & Support Portal",
    page_icon="📩",
    layout="wide"
)


# Function to add a background image
def add_bg_from_base64(base64_string):
    encoded_string = "data:image/png;base64," + base64_string
    st.markdown(
        f"""
        <style>
        .stApp {{
            background-image: url("{encoded_string}");
            background-size: cover;
            background-repeat: no-repeat;
            background-attachment: fixed;
        }}
        </style>
        """,
        unsafe_allow_html=True
    )


# Function to load vector store
# Function to load vector store
@st.cache_resource
def load_vector_store():
    embedding_model = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

    # Try multiple possible locations for the index
    possible_paths = [
        "faiss_ticket_index",  # Current directory
        "smart-ticketing/faiss_ticket_index",  # In smart-ticketing subdirectory
        os.path.join(os.path.dirname(__file__), "faiss_ticket_index"),  # Relative to script
    ]

    # Try each path until one works
    for path in possible_paths:
        if os.path.exists(path):
            return FAISS.load_local(
                path,
                embeddings=embedding_model,
                allow_dangerous_deserialization=True
            )

    # If no paths worked, raise an error
    raise FileNotFoundError(f"Could not find FAISS index in any of: {possible_paths}")


# Custom CSS
st.markdown("""
<style>
    .main-container {
        max-width: 1200px;
        padding: 0;
    }
    .block-container {
        padding-top: 1rem;
        padding-bottom: 1rem;
    }
    .card {
        border-radius: 10px;
        padding: 1.5rem;
        margin-bottom: 1rem;
        background-color: rgba(255, 255, 255, 0.95);
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    .header {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin-bottom: 2rem;
        padding: 1rem;
        border-radius: 10px;
        background-color: #003087;
        color: white;
    }
    .header img {
        height: 50px;
    }
    .paypal-blue {
        color: #003087;
    }
    .paypal-light-blue {
        color: #0070E0;
    }
    .ticket-card {
        border-left: 4px solid #0070E0;
        padding: 1rem;
        margin-bottom: 1rem;
        background-color: rgba(255, 255, 255, 0.95);
        border-radius: 5px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
    }
    .ticket-id {
        font-weight: bold;
        color: #003087;
    }
    .footer {
        text-align: center;
        margin-top: 2rem;
        padding: 1rem;
        color: #666;
        font-size: 0.8rem;
    }
    .stTextInput > div > div > input {
        background-color: white;
        border: 2px solid #0070E0;
        padding: 1rem;
        border-radius: 10px;
    }
    .tab-content {
        padding: 20px 0;
    }
</style>
""", unsafe_allow_html=True)

# PayPal logo as base64
paypal_logo_base64 = """
iVBORw0KGgoAAAANSUhEUgAAAJYAAAAyCAYAAAC+jCIaAAAACXBIWXMAAA7DAAAOwwHHb6hkAAAA
GXRFWHRTb2Z0d2FyZQB3d3cuaW5rc2NhcGUub3Jnm+48GgAAB4dJREFUeJztnHlsFFUcxz+zs7O9
97Db0nZbWiy0SCk9KAcBuQpIQKIoYECFQAQhEjWiiUQE/1ASDQgJGkJQI1cAQxWQywqIcgqEtgJt
KW1tS9uUHtvudnfH+UMCxO7Mzu7O7tTO95/Jvve7731nPvv2/d57vyfIsiwjI+NlRKUNkBnayMLy
AQRJQiyshOLr4JFAkEDm/r+5tweSBJIWRFGG2tA+GGISC8YaBYERMfK4PEAWlhdwVNVQt3U7qD2f
lXabGbvld0AFssWCOFyP5vHRaOMTvWBpYEIWloeUfrcXW0GJp8XckJm9UCpKwUutyFEZDnYrdoud
A+t2cGXPSRrKb2KrqEKqbQBnB2/QEEFsZBjauAi0CcPoMTWN6GnjCU+K99DoexvZs/KQ88fOU3K4
gGt7z1B19jIIAshD1HsIAoIoIgpCpxMVZrMZSZLwVowqCILTdwmCgEbQoNFqe/DG8GQiJ6QwYkEG
Qwf3c+tdQwVZWC7y+6e/svutFQiiGHSicoYgiqgEFWqN2u3rNBoNWq0WQfj3rxYdHY3J5HrDZnp6
OocOHXJafuzYserdu3dPdPnGXkQWlgsc2LCLI6u2Bt0MZY8ojJ2XxaxXn3FaZjAYNj///PPfeSOu
Ki8vD1CpNWGuhPMWsrCc4HBImKus7NzxG4d37KP0TDHImQoAVCo1GzduLFi9evU8b8SVnUJ3yC+v
4Kttu9i37zS1Dbbghj0YEEUMrz+XO+/ZWd7qyXRYG/ji9Z/Yve8cbW3BNLsHD72TYshZMtdpGa/N
WHIe6x5lZ0v44M1VlJXdhPvA11YUxdiwsLBbra3ufwsAWVgdnD5+ia+/3UVbe2C+TnvNLZrr6jDf
bsBut2OzWnE4HEiShCt5a1EUUatvpx5UKhUqlRotWrSlZRzZeJSausB8pva2NsxmM2azGYfdftf/
tVotOp0OnU6HRqPBVTXJwvp/5u/bd9vbS3fj6KQR3vr2Wy59tgHJbndZ0AaDAYdTQcMYYxyx0XHE
xsYSExNDTEwM0dHRREVFERkZSWRkJJGRkej1evR6PeHh4QzsP5Dw8HC3P1dpaSlnzpzh7Nmz5Ofn
k5+fT3l5OdXV1dTV1VFfX09DQwONjY00NTXd89okSUIURcLCwigsLOTvxGNgCGuvVnfvRzXf+IS+
/frdd93R3kbxpi1c3rDZIzEZjUaam5u7PBcZGcmQIUNISkpi4MCBJCQkkJCQQHx8PAMGDCA2Lo7Y
2Fh0Ol2X97FarVRWVlJeXk5ZWRkXL17k7NmznDt3jkuXLmGxWO66JjQ0FKvVSkhIiEefz+FwIIoi
8serrwTOWnkApz5UKjp3B7Tbqb9UgMPSwkiTyaV72e12TCYTZWVllJaWUlJSQklJCcXFxVy9epXr
169z48YNqqurqa6upqqqiqqqqk5jSJLEtevXXDLS22g0GkRRRJZliI8PnEnBU7oUlsvJpA6sFo9j
V1ZWUllZ6fZ1lZWVHsf1BkNHjmP3L9W0NZuRu/mBVCoVDQ0NfkwfuE6IC+wXRID+ptneYth4E2nZ
o4L2Y/obWVguEB0dwviz7yJbbrcPqbPdJgvLRcJC1cTUlKLOGSp3Gf+Ccwqfkk7aI3FKm+BV5BnL
HZKTYfdO+edSEFlYbhId13W4pK8iC8tN4uJCiX9kEqXb92OpqVPaHI+QheUBA/VmDLmDaTt2CrMLP
1ogIgvLQ3qHtSCmxsMfx6i/Wa20OW4hC8sLCCIklgGXb9FcfElpY1xGFpaXiK+CmCvQcPwvbLdqlT
bHJYKvfe9jDK2FyAtQX1SEZHcobY5TZGF5mfhyCLsGjUVFSB1rtAIVWVg+YEgNxFyC
"""

# Light blue background pattern
bg_base64 = """
iVBORw0KGgoAAAANSUhEUgAAAV4AAAFeCAMAAAD69YcoAAAAA1BMVEX///+nxBvIAAAASElEQVR4nO3BAQEAAACAkP6v7ggKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACZpEAAAcZtIiEAAAAASUVORK5CYII=
"""

# Add background with light gradient
add_bg_from_base64(bg_base64)

# Load vector store
try:
    vectorstore = load_vector_store()
    vector_store_loaded = True
except Exception as e:
    st.error(f"Error loading vector store: {e}")
    vector_store_loaded = False

# App layout
col1, col2, col3 = st.columns([1, 3, 1])
with col2:
    # Header with PayPal logo
    st.markdown(f"""
    <div class="header">
        <img src="data:image/png;base64,{paypal_logo_base64}">
        <h1>Ticketing Portal</h1>
    </div>
    """, unsafe_allow_html=True)

    # Create tabs
    tab1, tab2 = st.tabs(["📋 Smart ticketing", "🔍 Incident Pattern"])

    # Tab 1: Support Tickets
    with tab1:
        st.markdown("""
        <div class="tab-content">
            <div class="card">
                <h3 class="paypal-blue">🎯 Find Similar Support Tickets</h3>
                <p>Describe your issue below, and I'll search our knowledge base for similar tickets that might help you.</p>
            </div>
        </div>
        """, unsafe_allow_html=True)

        # Query input for tickets
        query = st.text_input("", placeholder="📝 Describe your issue here...", key="ticket_query")

        # Results section for tickets
        # In your chat.py, modify the get_similar_tickets function call to include debugging
        if query and vector_store_loaded:
            with st.spinner("🔍 Searching for similar tickets..."):
                # Add debugging information
                st.write(f"Current working directory: {os.getcwd()}")
                st.write(f"Looking for index in: {os.path.join(os.getcwd(), 'faiss_ticket_index')}")

                # Check if the directory exists
                if os.path.exists('faiss_ticket_index'):
                    st.write("Found the faiss_ticket_index directory")
                    # Check if index files exist
                    if os.path.exists('faiss_ticket_index/index.faiss'):
                        st.write("Found the index.faiss file")
                    else:
                        st.write("index.faiss file doesn't exist in the directory")
                        st.write(f"Files in directory: {os.listdir('faiss_ticket_index')}")
                else:
                    st.write("faiss_ticket_index directory doesn't exist")
                    # Check parent directory structure
                    st.write(f"Files in current directory: {os.listdir('.')}")

                    if os.path.exists('smart-ticketing'):
                        st.write("Found smart-ticketing directory")
                        st.write(f"Files in smart-ticketing: {os.listdir('smart-ticketing')}")

                        if os.path.exists('smart-ticketing/faiss_ticket_index'):
                            st.write("Found faiss_ticket_index inside smart-ticketing")
                            st.write(f"Files: {os.listdir('smart-ticketing/faiss_ticket_index')}")

                # Try to load with absolute path
                try:
                    results = get_similar_tickets(query, k=3)
                except Exception as e:
                    st.error(f"Error loading index: {str(e)}")
                    st.error("Please check that the FAISS index files are in the correct location")
                    results = []

    # Tab 2: Incident Analysis
    with tab2:
        st.markdown("""
        <div class="tab-content">
            <div class="card">
                <h3 class="paypal-blue">🔍 Banking Incident Analysis</h3>
                <p>Enter an incident description and account number to analyze relevant customer data fields.</p>
            </div>
        </div>
        """, unsafe_allow_html=True)

        # Input fields for incident analysis
        incident_desc = st.text_area("Incident Description",
                                     placeholder="Example: Credit card declined at store in Germany")
        account_col1, account_col2 = st.columns([3, 1])

        with account_col1:
            account_num = st.text_input("Account Number", placeholder="Enter account number")

        with account_col2:
            analyze_btn = st.button("Analyze")

        # Process incident when button is clicked
        if analyze_btn and incident_desc:
            with st.spinner("Analyzing incident..."):
                try:
                    # Import here to avoid circular imports
                    from incidenthub.main import process_incident

                    # Use default account number if none provided
                    if not account_num:
                        account_num = "5230212689541666174"
                        st.info("Using default account for demonstration.")

                    # Process the incident
                    result = process_incident(incident_desc, account_num)

                    # Display results
                    if 'error' in result.get('relevant_values', {}):
                        st.error(result['relevant_values']['error'])
                    else:
                        st.success("Analysis complete!")

                        # Displaying relevant fields
                        st.markdown("""
                        <div class="card">
                            <h4 class="paypal-blue">Relevant Fields Identified</h4>
                        </div>
                        """, unsafe_allow_html=True)

                        for category, fields in result['relevant_fields'].items():
                            if fields:
                                st.write(f"**{category.capitalize()}**: {', '.join(fields)}")

                        # Displaying relevant values
                        if result['relevant_values']:
                            st.markdown("""
                            <div class="card">
                                <h4 class="paypal-blue">Relevant Values</h4>
                            </div>
                            """, unsafe_allow_html=True)

                            for field, value in result['relevant_values'].items():
                                st.write(f"**{field}**: {value}")
                except Exception as e:
                    st.error(f"Error processing incident: {e}")
