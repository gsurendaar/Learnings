import json
import os


def get_training_data(file_path='data/incidents_data.json'):
    """
    Get training data from file or use default data if file not found

    Args:
        file_path: Path to the incidents data JSON file

    Returns:
        list: List of incident dictionaries with descriptions and relevant fields
    """
    # Try loading from external file first
    if os.path.exists(file_path):
        try:
            with open(file_path, 'r') as f:
                incidents_data = json.load(f)
                print(f"Loaded {len(incidents_data)} incidents from {file_path}")
                return incidents_data
        except json.JSONDecodeError:
            print(f"Error parsing {file_path}. Using default data.")
    else:
        print(f"File {file_path} not found. Using default data.")

    # Default training data as fallback
    return [
        {
            'incident_description': 'Credit card transactions failing for customers in Canada',
            'relevant_fields': {
                'user': ['country'],
                'account': ['card_type'],
                'transaction': ['transaction_channel', 'transaction_status']
            }
        },
        {
            'incident_description': 'Business customers unable to access corporate accounts in UK',
            'relevant_fields': {
                'user': ['country', 'user_group'],
                'account': ['account_type', 'card_type'],
                'transaction': ['transaction_type']
            }
        },
        {
            'incident_description': 'Premium customers reporting incorrect balance after international transfers',
            'relevant_fields': {
                'user': ['user_group'],
                'account': ['account_type', 'account_balance'],
                'transaction': ['transaction_type', 'transaction_amount', 'transaction_status']
            }
        },
        {
            'incident_description': 'Mobile app authentication failing for German users',
            'relevant_fields': {
                'user': ['country'],
                'account': ['account_status'],
                'transaction': ['transaction_channel', 'transaction_type']
            }
        },
        {
            'incident_description': 'Duplicate card charges for Mexican retail transactions',
            'relevant_fields': {
                'user': ['country'],
                'account': ['card_type', 'card_status'],
                'transaction': ['transaction_type', 'transaction_subtype', 'transaction_amount']
            }
        },
        {
            'incident_description': 'Failed online payment using debit card',
            'relevant_fields': {
                'user': [],
                'account': ['card_type'],
                'transaction': ['transaction_amount', 'merchant_name', 'transaction_date']
            }
        },
        {
            'incident_description': 'Card declined at point of sale terminal',
            'relevant_fields': {
                'user': [],
                'account': ['card_type', 'card_status', 'account_balance'],
                'transaction': ['transaction_amount']
            }
        },
        {
            'incident_description': 'Unauthorized wire transfer from checking account',
            'relevant_fields': {
                'user': [],
                'account': ['account_type', 'account_balance'],
                'transaction': ['transaction_amount', 'transaction_date', 'transaction_type']
            }
        },
        {
            'incident_description': 'Customer reports they cannot complete a payment and their account shows negative balance',
            'relevant_fields': {
                'user': [],
                'account': ['account_balance', 'account_type'],
                'transaction': ['transaction_amount', 'transaction_status']
            }
        },
        {
            'incident_description': 'Credit card failed in US for personal customers',
            'relevant_fields': {
                'user': ['country'],
                'account': ['card_type', 'account_type'],
                'transaction': ['transaction_channel', 'transaction_status']
            }
        }
    ]