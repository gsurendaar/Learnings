import pandas as pd
import json
from collections import OrderedDict
import random

# Generate realistic account numbers
def generate_account_number():
    return str(random.randint(10**15, 10**18))

# Define users data
users_data = [
    {
        "user_id": "5230212689541666174",
        "user_email": "user1@example.com",
        "country": "US",
        "user_group": "Personal",
        "limitation": None
    },
    {
        "user_id": "4398172456903218765",
        "user_email": "user2@example.com",
        "country": "Canada",
        "user_group": "Business",
        "limitation": None
    },
    {
        "user_id": "7612093845217634980",
        "user_email": "user3@example.com",
        "country": "UK",
        "user_group": "Premium",
        "limitation": None
    },
    {
        "user_id": "9023148756321047896",
        "user_email": "user4@example.com",
        "country": "Germany",
        "user_group": "Personal",
        "limitation": None
    },
    {
        "user_id": "2134567890123456789",
        "user_email": "user5@example.com",
        "country": "France",
        "user_group": "Business",
        "limitation": None
    }
]

# Define accounts data with matching user_ids
accounts_data = [
    {
        "account_id": "1037652489012345678",
        "user_id": "5230212689541666174",
        "account_type": "Checking",
        "account_status": "Active",
        "card_type": "Debit",
        "card_status": "Active",
        "account_balance": 1500.00
    },
    {
        "account_id": "2048576912345678901",
        "user_id": "4398172456903218765",
        "account_type": "Corporate",
        "account_status": "Active",
        "card_type": "Credit",
        "card_status": "Active",
        "account_balance": 25000.00
    },
    {
        "account_id": "3098761452345678902",
        "user_id": "7612093845217634980",
        "account_type": "Premium",
        "account_status": "Active",
        "card_type": "Credit",
        "card_status": "Active",
        "account_balance": 10000.00
    },
    {
        "account_id": "4102938475612345678",
        "user_id": "9023148756321047896",
        "account_type": "Savings",
        "account_status": "Active",
        "card_type": "Debit",
        "card_status": "Active",
        "account_balance": 3000.00
    },
    {
        "account_id": "5123456789012345678",
        "user_id": "2134567890123456789",
        "account_type": "Business",
        "account_status": "Active",
        "card_type": "Credit",
        "card_status": "Active",
        "account_balance": 50000.00
    }
]

# Define transactions data with matching user_ids and account_ids
transactions_data = [
    {
        "transaction_id": "T0123456789012345",
        "user_id": "5230212689541666174",
        "account_id": "1037652489012345678",
        "transaction_type": "Purchase",
        "transaction_subtype": "Retail",
        "transaction_amount": 100.00,
        "transaction_status": "Completed",
        "transaction_date": "2024-03-15",
        "transaction_channel": "Online",
        "merchant_name": "Amazon"
    },
    {
        "transaction_id": "T1234567890123456",
        "user_id": "4398172456903218765",
        "account_id": "2048576912345678901",
        "transaction_type": "Transfer",
        "transaction_subtype": "Wire",
        "transaction_amount": 5000.00,
        "transaction_status": "Completed",
        "transaction_date": "2024-03-15",
        "transaction_channel": "Online",
        "merchant_name": None
    },
    {
        "transaction_id": "T2345678901234567",
        "user_id": "7612093845217634980",
        "account_id": "3098761452345678902",
        "transaction_type": "Withdrawal",
        "transaction_subtype": "ATM",
        "transaction_amount": 200.00,
        "transaction_status": "Completed",
        "transaction_date": "2024-03-15",
        "transaction_channel": "ATM",
        "merchant_name": None
    },
    {
        "transaction_id": "T3456789012345678",
        "user_id": "9023148756321047896",
        "account_id": "4102938475612345678",
        "transaction_type": "Interest",
        "transaction_subtype": "Credit",
        "transaction_amount": 5.00,
        "transaction_status": "Completed",
        "transaction_date": "2024-03-15",
        "transaction_channel": "System",
        "merchant_name": None
    },
    {
        "transaction_id": "T4567890123456789",
        "user_id": "2134567890123456789",
        "account_id": "5123456789012345678",
        "transaction_type": "Payment",
        "transaction_subtype": "Bill",
        "transaction_amount": 1000.00,
        "transaction_status": "Completed",
        "transaction_date": "2024-03-15",
        "transaction_channel": "Online",
        "merchant_name": "Utility Co"
    }
]

# Define incidents data
incidents_data = [
    {
        "incident_id": 1,
        "incident_type": "P1",
        "incident_description": "Credit card transactions failing for customers in Canada",
        "relevant_fields": {
            "user": ["country"],
            "account": ["card_type", "account_type"],
            "transaction": ["transaction_channel", "transaction_status"]
        },
        "relevant_values": {
            "country": "Canada",
            "card_type": "Credit Card",
            "transaction_channel": "Online"
        }
    },
    {
        "incident_id": 2,
        "incident_type": "P1",
        "incident_description": "Business customers unable to access corporate accounts in UK",
        "relevant_fields": {
            "user": ["country", "user_group"],
            "account": ["account_type", "card_type"],
            "transaction": ["transaction_type"]
        },
        "relevant_values": {
            "country": "UK",
            "user_group": "Business",
            "account_type": "Corporate"
        }
    },
    {
        "incident_id": 3,
        "incident_type": "P2",
        "incident_description": "Premium customers reporting incorrect balance after international transfers",
        "relevant_fields": {
            "user": ["user_group"],
            "account": ["account_type", "account_balance"],
            "transaction": ["transaction_type", "transaction_amount", "transaction_status"]
        },
        "relevant_values": {
            "user_group": "Premium",
            "transaction_type": "Transfer"
        }
    },
    {
        "incident_id": 4,
        "incident_type": "P1",
        "incident_description": "Mobile app authentication failing for German users",
        "relevant_fields": {
            "user": ["country"],
            "account": ["account_status"],
            "transaction": ["transaction_channel", "transaction_type"]
        },
        "relevant_values": {
            "country": "Germany",
            "transaction_channel": "Mobile App"
        }
    },
    {
        "incident_id": 5,
        "incident_type": "P2",
        "incident_description": "Duplicate card charges for Mexican retail transactions",
        "relevant_fields": {
            "user": ["country"],
            "account": ["card_type", "card_status"],
            "transaction": ["transaction_type", "transaction_subtype", "transaction_amount"]
        },
        "relevant_values": {
            "country": "Mexico",
            "transaction_subtype": "Retail"
        }
    }
]

def remove_duplicates(data):
    """Remove duplicate incidents based on incident description"""
    seen = set()
    unique_data = []

    for incident in data:
        desc = incident['incident_description']
        if desc not in seen:
            seen.add(desc)
            unique_data.append(incident)

    return unique_data

def save_incidents_data():
    """Save incidents data to both JSON and CSV formats"""
    # Remove duplicates
    unique_incidents = remove_duplicates(incidents_data)

    # Reindex incident_ids
    for i, incident in enumerate(unique_incidents, 1):
        incident['incident_id'] = i

    # Save as JSON
    with open('data/incidents_data.json', 'w') as f:
        json.dump(unique_incidents, f, indent=2)

    # Convert to DataFrame and save as CSV
    df = pd.DataFrame(unique_incidents)
    # Convert dictionary fields to JSON strings for CSV storage
    df['relevant_fields'] = df['relevant_fields'].apply(json.dumps)
    df['relevant_values'] = df['relevant_values'].apply(json.dumps)
    df.to_csv('incidents_data.csv', index=False)

    return len(unique_incidents)

if __name__ == "__main__":
    # Save users data
    pd.DataFrame(users_data).to_csv("data/users_data.csv", index=False)

    # Save accounts data
    pd.DataFrame(accounts_data).to_csv("data/accounts_data.csv", index=False)

    # Save transactions data
    pd.DataFrame(transactions_data).to_csv("data/transactions_data.csv", index=False)

    # Save incidents data and get count of unique incidents
    unique_count = save_incidents_data()

    print(f"Sample datasets created and saved as CSV files")
    print(f"Saved {unique_count} unique incidents to incidents_data.json")