import pandas as pd
import json
import os
from IncidentPatternExtractor import get_or_train_model


def generate_datasets():
    """
    Generate datasets if they don't exist
    """
    if not os.path.exists('data/incidents_data.csv'):
        print("Generating sample datasets...")
        import dataset_generation
        print("Sample datasets generated.")
    else:
        print("Using existing datasets.")


def load_customer_data(account_number):
    """
    Load user, account, and transaction data for a specific user

    Args:
        account_number (str): Account number to load data for

    Returns:
        tuple: (user_data, accounts_data, transactions_data)
    """
    # Load data
    users_df = pd.read_csv('data/users_data.csv')
    accounts_df = pd.read_csv('data/accounts_data.csv')
    transactions_df = pd.read_csv('data/transactions_data.csv')

    # Convert to string for comparison if not already
    users_df['user_id'] = users_df['user_id'].astype(str)
    accounts_df['user_id'] = accounts_df['user_id'].astype(str)
    accounts_df['account_id'] = accounts_df['account_id'].astype(str)
    transactions_df['user_id'] = transactions_df['user_id'].astype(str)
    transactions_df['account_id'] = transactions_df['account_id'].astype(str)

    # First try to match by account_id
    matching_accounts = accounts_df[accounts_df['account_id'] == account_number].to_dict('records')

    # If no match by account_id, try by user_id
    if not matching_accounts:
        matching_accounts = accounts_df[accounts_df['user_id'] == account_number].to_dict('records')

    # If still no match, return empty data
    if not matching_accounts:
        return {}, [], []

    # Get user_id from the matching account
    user_id = matching_accounts[0]['user_id']

    # Get user data
    user_data = users_df[users_df['user_id'] == user_id].to_dict('records')
    if user_data:
        user_data = user_data[0]
    else:
        user_data = {}

    # Get all accounts for this user
    user_accounts = accounts_df[accounts_df['user_id'] == user_id].to_dict('records')

    # Get transactions for these accounts
    account_ids = [account['account_id'] for account in user_accounts]
    user_transactions = transactions_df[transactions_df['account_id'].isin(account_ids)].to_dict('records')

    return user_data, user_accounts, user_transactions


def process_incident(incident_description, account_number):
    """
    Process an incident description for a specific account number

    Args:
        incident_description (str): Description of the incident
        account_number (str): Account number of the customer

    Returns:
        dict: Relevant fields and values for this incident
    """
    # Get trained model (trains if needed)
    model = get_or_train_model()

    # Load customer data
    user_data, accounts_data, transactions_data = load_customer_data(account_number)

    if not user_data:
        return {
            'incident_description': incident_description,
            'relevant_fields': {},
            'relevant_values': {'error': f'No data found for account number {account_number}'}
        }

    # Predict relevant fields
    relevant_fields = model.predict(incident_description)

    # For demonstration purposes, we'll use the first account and transaction
    # In a real system, you'd need to determine the most relevant account/transaction
    account_data = accounts_data[0] if accounts_data else {}
    transaction_data = transactions_data[0] if transactions_data else {}

    # Extract relevant values
    relevant_values = model.extract_values(
        user_data, account_data, transaction_data, relevant_fields
    )

    return {
        'incident_description': incident_description,
        'relevant_fields': relevant_fields,
        'relevant_values': relevant_values
    }


def interactive_demo():
    """
    Run an interactive demonstration of the incident pattern extraction
    """
    print("\n===== Banking Incident Pattern Recognition System =====")
    print("This system identifies relevant customer data fields based on incident descriptions.")

    while True:
        # Get incident description
        incident_description = input("\nEnter incident description (or 'exit' to quit): ")
        if incident_description.lower() == 'exit':
            break

        # Get account number
        account_number = input("Enter account number: ")
        if not account_number:
            print("No account number provided. Using a default account.")
            account_number = "5230212689541666174"  # Default account

        # Process incident
        result = process_incident(incident_description, account_number)

        # Display results
        print("\nResults:")
        print(f"Incident: {result['incident_description']}")

        if 'error' in result.get('relevant_values', {}):
            print(f"\nError: {result['relevant_values']['error']}")
            continue

        print("\nRelevant fields identified:")
        for category, fields in result['relevant_fields'].items():
            if fields:
                print(f"  {category.capitalize()}: {', '.join(fields)}")

        print("\nRelevant values:")
        for field, value in result['relevant_values'].items():
            print(f"  {field}: {value}")

        print("\n-------------------------------------------")


if __name__ == "__main__":
    # Generate datasets if they don't exist
    generate_datasets()

    # Run interactive demo
    interactive_demo()