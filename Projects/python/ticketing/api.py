# api.py
from flask import Flask, request, jsonify
import os
import sys
import json
import traceback

# Add the smart-ticketing directory to the path
script_dir = os.path.dirname(os.path.abspath(__file__))
smart_ticketing_path = os.path.join(script_dir, "smart-ticketing")
sys.path.append(smart_ticketing_path)

# Add the incidenthub directory to the path
incidenthub_path = os.path.join(script_dir, "incidenthub")
sys.path.append(incidenthub_path)

# Now import after adding paths
from search_similar import get_similar_tickets
from incidenthub.main import process_incident, load_customer_data

app = Flask(__name__)

import re


def get_exact_match_incident(incident_description, account_number):
    """
    Check if incident description exactly matches one in incidents_data.json
    Applies normalization rules to improve matching chances.
    """
    try:
        # Get the path to incidents_data.json
        incidents_file_path = os.path.join(incidenthub_path, 'data', 'incidents_data.json')

        with open(incidents_file_path, 'r') as f:
            incidents_data = json.load(f)

        # Load customer data
        user_data, accounts_data, transactions_data = load_customer_data(account_number)

        if not user_data:
            return {
                'incident_description': incident_description,
                'relevant_fields': {},
                'relevant_values': {'error': f'No data found for account number {account_number}'}
            }

        # Extract original values from incident description before normalization
        original_values = {}

        # Extract country
        country_pattern = r'\b(Germany|US|USA|Canada|France|Europe|UK|Mexico|Russia)\b'
        country_match = re.search(country_pattern, incident_description, re.IGNORECASE)
        if country_match:
            original_values['country'] = country_match.group(0)

        # Extract user group
        user_group_pattern = r'\b(Personal|Premium|Business)\b'
        user_group_match = re.search(user_group_pattern, incident_description, re.IGNORECASE)
        if user_group_match:
            original_values['user_group'] = user_group_match.group(0)
            # If account_type is relevant, use the same value
            original_values['account_type'] = user_group_match.group(0)

        # Extract card type
        card_pattern = r'\b(Debit Card|Credit Card|Any Card|All Card|All Cards|Debit Cards)\b'
        card_match = re.search(card_pattern, incident_description, re.IGNORECASE)
        if card_match:
            original_values['card_type'] = card_match.group(0)

        # Extract transaction subtype (retail/merchant)
        subtype_pattern = r'\b(Retail|Merchant)\b'
        subtype_match = re.search(subtype_pattern, incident_description, re.IGNORECASE)
        if subtype_match:
            original_values['transaction_subtype'] = subtype_match.group(0)

        def normalize_text(text):
            """Normalize text by applying all replacement rules"""
            normalized = text

            # 1. Replace user group terms
            normalized = re.sub(r'\b(Personal|Premium)\b', 'Business', normalized, flags=re.IGNORECASE)

            # 2. Replace card type terms
            normalized = re.sub(r'\b(Debit Card|Any Card|All Card|All Cards|Debit Cards)\b', 'Credit Card', normalized,
                                flags=re.IGNORECASE)

            # 3. Replace country names with "Russia"
            countries = ["Germany", "US", "USA", "Canada", "France", "Europe", "UK", "Mexico"]
            for country in countries:
                normalized = re.sub(rf'\b{country}\b', 'Russia', normalized, flags=re.IGNORECASE)

            # 4. Replace retail/merchant with corporate
            normalized = re.sub(r'\b(Retail|Merchant)\b', 'Corporate', normalized, flags=re.IGNORECASE)

            return normalized.lower()  # Return lowercase for case-insensitive comparison

        # Normalize the input incident description
        normalized_input = normalize_text(incident_description)

        # Debug output
        print(f"Original: '{incident_description}'")
        print(f"Normalized: '{normalized_input}'")
        print(f"Extracted original values: {original_values}")

        # Check for match using normalized descriptions
        for incident in incidents_data:
            # Normalize the stored incident description in the same way
            normalized_stored = normalize_text(incident['incident_description'])

            # Print for debugging
            print(f"Comparing: '{normalized_input}' with '{normalized_stored}'")

            if normalized_input == normalized_stored:
                # Extract relevant values from customer data
                account_data = accounts_data[0] if accounts_data else {}
                transaction_data = transactions_data[0] if transactions_data else {}

                # Get values for the relevant fields
                relevant_values = {}
                for category, fields in incident['relevant_fields'].items():
                    data_source = None
                    if category == 'user':
                        data_source = user_data
                    elif category == 'account':
                        data_source = account_data
                    elif category == 'transaction':
                        data_source = transaction_data

                    if data_source:
                        for field in fields:
                            if field in data_source:
                                relevant_values[field] = data_source[field]

                # Use predefined values if available
                if 'relevant_values' in incident:
                    # Start with predefined values
                    predefined_values = incident['relevant_values'].copy()

                    # Override with original extracted values when available
                    for field in predefined_values:
                        if field in original_values:
                            predefined_values[field] = original_values[field]

                    relevant_values.update(predefined_values)
                else:
                    # If there are no predefined values, use extracted original values
                    for field in original_values:
                        if field not in relevant_values:
                            relevant_values[field] = original_values[field]

                return {
                    'incident_description': incident_description,
                    'relevant_fields': incident['relevant_fields'],
                    'relevant_values': relevant_values
                }

        # No match found
        return None

    except Exception as e:
        print(f"Error finding exact match: {e}")
        traceback.print_exc()  # Print the full stack trace for debugging
        return None


def clean_incident_result(result, incident_description):
    """
    Clean up the incident result before returning to API:
    - Remove fields with 'id' or 'amount' in their names
    - Replace 'checking' account_type with appropriate value from description

    Args:
        result (dict): The incident processing result
        incident_description (str): Original incident description

    Returns:
        dict: Cleaned result
    """
    if not result or 'relevant_fields' not in result or 'relevant_values' not in result:
        return result

    # Extract account type from description
    account_type_pattern = r'\b(Personal|Premium|Business|Retail|Corporate|Merchant|Guest)\b'
    account_type_match = re.search(account_type_pattern, incident_description, re.IGNORECASE)
    extracted_account_type = account_type_match.group(0) if account_type_match else 'Business'

    # Clean relevant fields
    cleaned_fields = {}
    for category, fields in result['relevant_fields'].items():
        cleaned_category_fields = []
        for field in fields:
            if 'id' not in field.lower() and 'amount' not in field.lower():
                cleaned_category_fields.append(field)

        if cleaned_category_fields:
            cleaned_fields[category] = cleaned_category_fields

    # Clean relevant values
    cleaned_values = {}
    for field, value in result['relevant_values'].items():
        # Skip fields with 'id' or 'amount' in their name
        if 'id' in field.lower() or 'amount' in field.lower():
            continue

        # Special handling for account_type
        if field == 'account_type' and str(value).lower() == 'checking':
            cleaned_values[field] = extracted_account_type
        else:
            cleaned_values[field] = value

    # Create cleaned result
    cleaned_result = result.copy()
    cleaned_result['relevant_fields'] = cleaned_fields
    cleaned_result['relevant_values'] = cleaned_values

    return cleaned_result


@app.route('/api/similar-tickets', methods=['POST'])
def similar_tickets_api():
    """
    API endpoint to find similar tickets based on a query

    Request body:
    {
        "query": "description of the issue",
        "k": 3  // optional, number of results to return
    }
    """
    data = request.json

    if not data or 'query' not in data:
        return jsonify({"error": "Missing 'query' in request body"}), 400

    query = data['query']
    k = data.get('k', 3)  # Default to 3 results if not specified

    try:
        results = get_similar_tickets(query, k=k)

        # Format the results for JSON response
        formatted_results = []
        for doc in results:
            formatted_results.append({
                "content": doc.page_content,
                "metadata": doc.metadata
            })

        return jsonify({
            "query": query,
            "results": formatted_results
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/process-incident', methods=['POST'])
def process_incident_api():
    """
    API endpoint to process an incident description for a specific account

    Request body:
    {
        "incident_description": "Credit card declined at store in Germany",
        "account_number": "5230212689541666174"  // optional
    }
    """
    data = request.json

    if not data or 'incident_description' not in data:
        return jsonify({"error": "Missing 'incident_description' in request body"}), 400

    incident_description = data['incident_description']
    account_number = data.get('account_number', "5230212689541666174")  # Use default if not provided

    try:
        # First check for exact match
        exact_match = get_exact_match_incident(incident_description, account_number)

        if exact_match:
            # Return the exact match result
            result = exact_match
        else:
            # Fall back to model processing
            result = process_incident(incident_description, account_number)
        final_result = clean_incident_result(result, incident_description)

        return jsonify(final_result)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)