import streamlit as st
import requests
import json
import re
import os
import pandas as pd
import time

# Configure page layout and title
st.set_page_config(
    page_title="Ticket Hub - One stop solution for all your ticketing needs",
    layout="wide",
    initial_sidebar_state="expanded"
)


# Function to create dataset files directly
def create_minimal_datasets():
    """Create minimal dataset files to prevent errors"""
    # Ensure data directory exists
    os.makedirs("data", exist_ok=True)

    # Create users_data.csv if it doesn't exist
    if not os.path.exists("data/users_data.csv"):
        users_df = pd.DataFrame({
            'user_id': ['1', '2', '3'],
            'name': ['John Doe', 'Jane Smith', 'Robert Johnson'],
            'email': ['john@example.com', 'jane@example.com', 'robert@example.com'],
            'phone': ['555-123-4567', '555-234-5678', '555-345-6789'],
            'address': ['123 Main St', '456 Oak Ave', '789 Pine Blvd']
        })
        users_df.to_csv("data/users_data.csv", index=False)

    # Create accounts_data.csv if it doesn't exist
    if not os.path.exists("data/accounts_data.csv"):
        accounts_df = pd.DataFrame({
            'account_id': ['5230212689541666174', '9876543210123456', '1234567890123456'],
            'user_id': ['1', '2', '3'],
            'account_type': ['checking', 'savings', 'credit'],
            'balance': [1500.00, 25000.00, -450.75],
            'currency': ['USD', 'USD', 'USD'],
            'status': ['active', 'active', 'active']
        })
        accounts_df.to_csv("data/accounts_data.csv", index=False)

    # Create transactions_data.csv if it doesn't exist
    if not os.path.exists("data/transactions_data.csv"):
        transactions_df = pd.DataFrame({
            'transaction_id': ['t1001', 't1002', 't1003', 't1004'],
            'user_id': ['1', '1', '2', '3'],
            'account_id': ['5230212689541666174', '5230212689541666174', '9876543210123456', '1234567890123456'],
            'amount': [120.50, 50.25, 1000.00, 85.43],
            'transaction_type': ['purchase', 'withdrawal', 'deposit', 'purchase'],
            'merchant': ['Grocery Store', 'ATM', 'Bank Transfer', 'Gas Station'],
            'timestamp': ['2023-04-15 14:23:45', '2023-04-14 10:45:22', '2023-04-13 16:30:00', '2023-04-12 09:15:18']
        })
        transactions_df.to_csv("data/transactions_data.csv", index=False)

    # Create tickets dataset if needed
    if not os.path.exists("data/tickets.csv"):
        tickets_df = pd.DataFrame({
            'ticket_id': ['1', '2', '3'],
            'title': ['Password Reset', 'Account Locked', 'Suspicious Transaction'],
            'description': [
                'User cannot reset password via link',
                'Account locked after multiple failed login attempts',
                'Customer reports unauthorized transaction on their account'
            ],
            'resolution': [
                'Reset link was expired. Generated new password reset token and sent fresh email. Advised user to complete reset within 24 hours.',
                'Verified identity and unlocked account. Reset password and enabled two-factor authentication.',
                'Investigated transaction and confirmed it was fraudulent. Reversed charge, froze account, and issued new card.'
            ],
            'resource_link': [
                'https://support.example.com/kb/password-reset-guide',
                'https://support.example.com/kb/account-security',
                'https://support.example.com/kb/fraud-protection'
            ]
        })
        tickets_df.to_csv("data/tickets.csv", index=False)


# Function to render content with clickable links
def render_content_with_links(content):
    if not content:
        return ""
    url_pattern = r'(https?://[^\s]+)'
    content_with_links = re.sub(
        url_pattern,
        r'<a href="\1" target="_blank" style="color:#0070ba;text-decoration:underline;">\1</a>',
        content
    )
    return content_with_links


# Custom loading animation
def display_custom_spinner(message="Processing..."):
    with st.spinner(message):
        st.markdown("""
        <div class="loading-spinner">
            <div class="spinner"></div>
            <p class="loading-text">{}</p>
        </div>
        """.format(message), unsafe_allow_html=True)


# Submit a new ticket function
def submit_ticket(title, description, category):
    # In a real app, this would send data to your backend
    # For demo purposes, we'll just show success and save to session state
    time.sleep(1)  # Simulate API call

    if 'submitted_tickets' not in st.session_state:
        st.session_state.submitted_tickets = []

    new_ticket = {
        'title': title,
        'description': description,
        'category': category,
        'status': 'Open',
        'created': pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')
    }

    st.session_state.submitted_tickets.append(new_ticket)
    return True


# Generate datasets when loading the app
if 'data_initialized' not in st.session_state:
    with st.spinner("Initializing AI models..."):
        create_minimal_datasets()
    st.session_state.data_initialized = True

# Custom CSS with improved styling and loading animations
st.markdown("""
<style>
    /* Main application styling */
    .main-header {
        background: linear-gradient(135deg, #0070ba, #1546a0);
        color: white;
        padding: 20px;
        border-radius: 10px;
        margin-bottom: 20px;
        text-align: center;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .app-title {
        font-weight: bold;
        font-size: 32px;
        margin-bottom: 5px;
    }

    .app-subtitle {
        font-size: 18px;
        opacity: 0.9;
    }

    /* Card styling */
    .ticket-header {
        padding: 15px;
        background: linear-gradient(135deg, #0070ba, #005ea3);
        color: white;
        border-radius: 8px 8px 0 0;
        font-weight: bold;
        font-size: 16px;
    }

    .ticket-body {
        padding: 18px;
        background-color: #ffffff;
        border: 1px solid #e0e0e0;
        border-top: none;
        border-radius: 0 0 8px 8px;
        margin-bottom: 20px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
    }

    .metadata-item {
        background-color: #f0f7fc;
        padding: 10px;
        border-left: 4px solid #0070ba;
        margin: 8px 0;
        border-radius: 0 4px 4px 0;
    }

    .highlight {
        background-color: #fffde7;
        padding: 3px 5px;
        border-radius: 3px;
    }

    /* Button styling */
    .paypal-button {
        background-color: #0070ba;
        color: white;
        padding: 12px 24px;
        border-radius: 6px;
        text-align: center;
        margin: 15px 0;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.3s ease;
    }

    .paypal-button:hover {
        background-color: #005ea3;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
    }

    /* Form styling */
    .form-container {
        background-color: #ffffff;
        padding: 20px;
        border-radius: 8px;
        border: 1px solid #e0e0e0;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
    }

    /* Loading animation */
    .loading-spinner {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 20px;
    }

    .spinner {
        width: 50px;
        height: 50px;
        border: 5px solid #f3f3f3;
        border-top: 5px solid #0070ba;
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }

    .loading-text {
        margin-top: 15px;
        color: #0070ba;
        font-weight: bold;
    }

    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }

    /* Sidebar customization */
    .sidebar-content {
        padding: 15px;
        background-color: #f7f7f7;
        border-radius: 8px;
        margin-bottom: 15px;
    }

    .model-info {
        padding: 10px;
        background-color: #e6f7ff;
        border-left: 4px solid #0070ba;
        margin: 10px 0;
        border-radius: 0 4px 4px 0;
    }

    /* Success message */
    .success-message {
        background-color: #d4edda;
        color: #155724;
        padding: 15px;
        border-radius: 8px;
        border: 1px solid #c3e6cb;
        margin: 15px 0;
        text-align: center;
    }

    /* Tab styling */
    .stTabs [data-baseweb="tab-list"] {
        gap: 10px;
    }
    .stTabs [data-baseweb="tab"] {
        height: 50px;
        white-space: pre-wrap;
        background-color: white;
        border-radius: 5px 5px 0 0;
        border: 1px solid #e0e0e0;
        border-bottom: none;
        padding: 5px 10px !important;
    }
    .stMainBlockContainer{
        padding: 2.9rem 1rem 10rem !important;
    }

    .stTabs [aria-selected="true"] {
        background-color: #0070ba !important;
        color: white !important;
        padding: 7px 15px !important;
    }
</style>

""", unsafe_allow_html=True)

# Sidebar with model info
with st.sidebar:
    st.title("Ticketing Hub")
    st.subheader("One stop solution for all your ticketing needs")

    st.markdown("""
    <div class="sidebar-content">
        <h3>About the Models</h3>
        <div class="model-info">
            <strong>NLP Engine:</strong> Text processing using advanced language models
        </div>
        <div class="model-info">
            <strong>Similarity Search:</strong> Vector embedding based retrieval
        </div>
        <div class="model-info">
            <strong>Incident Processing:</strong> Multi-layered classification system 
        </div>
    </div>
    """, unsafe_allow_html=True)

    st.markdown("---")

    st.markdown("""
    <div class="sidebar-content">
        <h3>Active Models</h3>
        <ul>
            <li>Text Classification</li>
            <li>Named Entity Recognition</li>
            <li>Semantic Search</li>
            <li>Entity Extraction</li>
        </ul>
    </div>
    """, unsafe_allow_html=True)

    st.markdown("---")

    if st.button("Refresh Data", key="refresh_button"):
        with st.spinner("Refreshing data..."):
            time.sleep(1)
            create_minimal_datasets()
        st.success("Data refreshed successfully")

# Create tabs with improved styling - removed Chat and API Testing tabs
tabs = st.tabs(["Similar Tickets", "Incident Pattern"])

# Similar Tickets tab with ticket creation functionality
with tabs[0]:
    st.header("Similar Tickets Search")
    st.markdown("Find similar support tickets or create a new one if you can't find what you need.")

    query = st.text_area("Enter your query:", height=100)
    k_value = st.slider("Number of results (k):", min_value=1, max_value=10, value=3)

    col1, col2 = st.columns([1, 5])
    with col1:
        search_btn = st.button("Search Tickets", key="tab1_search")

    if search_btn and query:
        with st.spinner("Searching for similar tickets..."):
            try:
                # Show a bit more elaborate loading
                for i in range(3):
                    time.sleep(0.5)

                response = requests.post(
                    "http://localhost:5000/api/similar-tickets",
                    headers={"Content-Type": "application/json"},
                    data=json.dumps({"query": query, "k": k_value})
                )

                if response.status_code == 200:
                    data = response.json()
                    st.success(f"Found {len(data['results'])} similar tickets!")

                    found_tickets = len(data['results']) > 0

                    for i, result in enumerate(data['results']):
                        title = result['metadata'].get('title', 'Untitled Ticket')

                        st.markdown(f"""
                        <div class="ticket-header">
                            Ticket {i + 1}: {title}
                        </div>
                        <div class="ticket-body">
                            <p><strong>Description:</strong> {render_content_with_links(result['content'])}</p>
                        </div>
                        """, unsafe_allow_html=True)

                        with st.expander("Show Additional Details"):
                            for key, value in result['metadata'].items():
                                if isinstance(value, str) and (
                                        value.startswith('http://') or value.startswith('https://')):
                                    st.markdown(f"""
                                    <div class="metadata-item">
                                        <strong>{key.replace('_', ' ').title()}:</strong> <a href="{value}" target="_blank">{value}</a>
                                    </div>
                                    """, unsafe_allow_html=True)
                                else:
                                    st.markdown(f"""
                                    <div class="metadata-item">
                                        <strong>{key.replace('_', ' ').title()}:</strong> {value}
                                    </div>
                                    """, unsafe_allow_html=True)

                    # Add option to create a ticket if needed
                    st.markdown("---")
                    st.markdown("<h3>Didn't find what you're looking for?</h3>", unsafe_allow_html=True)

                    # Initialize session state for ticket creation
                    if 'ticket_creation_started' not in st.session_state:
                        st.session_state.ticket_creation_started = False

                    create_ticket = st.button("Create New Ticket")

                    if create_ticket:
                        st.session_state.ticket_creation_started = True

                    if st.session_state.ticket_creation_started:
                        st.markdown("<div>Success</div>")
                        with st.spinner("Creating new ticket..."):
                            time.sleep(0.5)
                            st.success("Ticket created successfully.")
                            time.sleep(0.5)
                            st.session_state.show_ticket_form = False
                            # Reset the state so it doesn't repeat on future reruns
                            st.session_state.ticket_creation_started = False

                else:
                    st.error(f"Error: {response.status_code}, {response.text}")
                    st.session_state.show_ticket_form = True
            except Exception as e:
                st.error(f"API request failed: {str(e)}")
                st.session_state.show_ticket_form = True

    elif search_btn:
        st.warning("Please enter a query.")

    if 'search_performed' not in st.session_state:
        st.session_state.search_performed = False

    # Show ticket form if needed
    if st.session_state.search_performed:
        # Create a layout with more columns to position the button to the right
        _, _, _, right_col = st.columns([2, 2, 2, 1])
        with right_col:
            create_btn = st.button("Create Ticket", key="create_ticket")

            # Handle ticket creation success
            if create_btn:
                st.session_state.ticket_created = True
                ticket_number = f"T{int(time.time()) % 10000}"
                st.session_state.ticket_number = ticket_number

    # Show success message if ticket was created
    if 'ticket_created' in st.session_state and st.session_state.ticket_created:
        st.markdown(f"""
        <div class="success-message">
            <h3>✅ Ticket Created Successfully!</h3>
            <p>Your ticket number is <strong>{st.session_state.ticket_number}</strong></p>
            <p>We'll notify you once there's an update on your ticket.</p>
        </div>
        """, unsafe_allow_html=True)
        # Reset the state after showing message
        if st.button("Create Another Ticket"):
            st.session_state.ticket_created = False

# Process Incident tab
with tabs[1]:
    st.header("Pattern Incident")
    st.markdown("Analyze incidents and extract relevant pattern automatically.")

    incident_desc = st.text_area("Enter incident description:", height=100, key="tab2_desc")
    account_num = st.text_input("Account Number:", "5230212689541666174", key="tab2_account")

    col1, col2 = st.columns([1, 5])
    with col1:
        process_btn = st.button("Find Pattern", key="tab2_process")

    if process_btn and incident_desc:
        with st.spinner("Processing incident..."):
            try:
                # Show elaborate loading
                for i in range(3):
                    time.sleep(0.5)

                response = requests.post(
                    "http://localhost:5000/api/process-incident",
                    headers={"Content-Type": "application/json"},
                    data=json.dumps({
                        "incident_description": incident_desc,
                        "account_number": account_num
                    })
                )

                if response.status_code == 200:
                    result = response.json()

                    if 'error' in result.get('relevant_values', {}):
                        st.error(result['relevant_values']['error'])
                    else:
                        st.success("Analysis complete!")

                        # Displaying relevant fields
                        st.subheader("Relevant Fields Identified")

                        for category, fields in result['relevant_fields'].items():
                            if fields:
                                st.markdown(f"""
                                <div class="metadata-item">
                                    <strong>{category.capitalize()}:</strong> {', '.join(fields)}
                                </div>
                                """, unsafe_allow_html=True)

                        # Displaying relevant values
                        if result['relevant_values']:
                            st.subheader("Relevant Values")
                            for field, value in result['relevant_values'].items():
                                st.markdown(f"""
                                <div class="metadata-item">
                                    <strong>{field}:</strong> <span class="highlight">{value}</span>
                                </div>
                                """, unsafe_allow_html=True)

                        # Add recommended actions
                        st.subheader("Recommended Actions")
                        st.markdown("""
                        <div class="ticket-body">
                            <ol>
                                <li>Verify account details and transaction history</li>
                                <li>Check for similar patterns in recent activity</li>
                                <li>Follow up with customer for additional information if needed</li>
                            </ol>
                        </div>
                        """, unsafe_allow_html=True)
                else:
                    st.error(f"Error: {response.status_code}, {response.text}")
            except Exception as e:
                st.error(f"API request failed: {str(e)}")
    elif process_btn:
        st.warning("Please enter an incident description.")