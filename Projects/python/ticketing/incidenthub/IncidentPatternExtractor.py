import pandas as pd
import pickle
import os
import json
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.multioutput import MultiOutputClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import MultiLabelBinarizer
from training_data import get_training_data


class IncidentPatternExtractor:
    def __init__(self):
        self.vectorizer = CountVectorizer(lowercase=True, stop_words='english')
        self.classifier = MultiOutputClassifier(RandomForestClassifier(n_estimators=100, random_state=42))
        self.mlb = MultiLabelBinarizer()
        self.field_names = []
        self.trained = False

    def _get_candidate_fields(self):
        """Define candidate fields for each entity type, excluding personal identifiers"""
        return {
            "user": ["country", "user_group", "limitation"],  # Removed user_id, user_email
            "account": ["account_type", "account_status", "card_type", "card_status", "account_balance"],
            # Removed account_id
            "transaction": ["transaction_type", "transaction_subtype", "transaction_amount",
                            "transaction_status", "transaction_channel", "merchant_name",
                            "transaction_date"]  # Removed transaction_id
        }

    def _clean_training_data(self, incidents_data):
        """Clean up training data by removing personal identifier fields"""
        personal_fields = ["user_id", "user_email", "account_id", "transaction_id", "transaction_amount"]

        for incident in incidents_data:
            if isinstance(incident, dict) and "relevant_fields" in incident:
                for entity_type in list(incident["relevant_fields"].keys()):
                    if entity_type in incident["relevant_fields"]:
                        # Remove personal identifier fields
                        incident["relevant_fields"][entity_type] = [
                            field for field in incident["relevant_fields"][entity_type]
                            if field not in personal_fields
                        ]

        return incidents_data

    def _prepare_training_data(self, incidents_df):
        """
        Prepare training data from incidents dataframe

        Args:
            incidents_df: DataFrame containing incident descriptions and relevant fields

        Returns:
            X: Features (incident descriptions)
            y: Labels (relevant fields for each entity type)
        """
        # Clean the data to remove personal fields
        if isinstance(incidents_df, pd.DataFrame):
            incidents_data = incidents_df.to_dict('records')
        else:
            incidents_data = incidents_df

        incidents_data = self._clean_training_data(incidents_data)

        # Convert JSON strings to dicts if needed
        if isinstance(incidents_df, pd.DataFrame):
            for i, row in enumerate(incidents_data):
                if isinstance(row['relevant_fields'], str):
                    incidents_data[i]['relevant_fields'] = json.loads(row['relevant_fields'])

        # Extract incident descriptions and relevant fields
        descriptions = [incident['incident_description'] for incident in incidents_data]

        # Create a list of sets of field labels
        field_labels = []
        candidate_fields = self._get_candidate_fields()
        all_possible_fields = []

        # Create a flattened list of all possible fields with entity prefix
        for entity, fields in candidate_fields.items():
            all_possible_fields.extend([f"{entity}_{field}" for field in fields])

        # Create field labels (list of sets)
        for incident in incidents_data:
            incident_fields = set()
            for entity, fields in incident.get('relevant_fields', {}).items():
                for field in fields:
                    # Skip personal identifier fields
                    if field in ["user_id", "user_email", "account_id", "transaction_id", "transaction_amount"]:
                        continue
                    incident_fields.add(f"{entity}_{field}")
            field_labels.append(incident_fields)

        # Store field names for later use
        self.field_names = all_possible_fields

        # Vectorize incident descriptions
        X = self.vectorizer.fit_transform(descriptions)

        # Transform field labels into binary format
        self.mlb.fit([set(all_possible_fields)])
        y = self.mlb.transform(field_labels)

        return X, y

    def train(self, incidents_df):
        """
        Train the model on incident data

        Args:
            incidents_df: DataFrame containing incident descriptions and relevant fields
        """
        X, y = self._prepare_training_data(incidents_df)
        self.classifier.fit(X, y)
        self.trained = True

    def predict(self, incident_description):
        """
        Predict relevant fields for an incident description

        Args:
            incident_description: String describing the incident

        Returns:
            dict: Dictionary mapping entity types to relevant fields
        """
        if not self.trained:
            raise ValueError("Model has not been trained yet")

        # Vectorize the incident description
        X = self.vectorizer.transform([incident_description])

        # Predict relevant fields
        y_pred = self.classifier.predict(X)

        # Convert binary prediction to field names
        predicted_fields = self.mlb.inverse_transform(y_pred)[0]

        # Group fields by entity type
        result = {"user": [], "account": [], "transaction": []}
        for field in predicted_fields:
            entity, field_name = field.split('_', 1)
            if entity in result:
                result[entity].append(field_name)

        return result

    def extract_values(self, user_data, account_data, transaction_data, relevant_fields):
        """
        Extract relevant values from customer data based on relevant fields

        Args:
            user_data: Dictionary containing user data
            account_data: Dictionary containing account data
            transaction_data: Dictionary containing transaction data
            relevant_fields: Dictionary mapping entity types to relevant fields

        Returns:
            dict: Dictionary mapping field names to their values
        """
        result = {}

        # Extract user values
        for field in relevant_fields.get("user", []):
            if field in user_data:
                result[field] = user_data[field]

        # Extract account values
        for field in relevant_fields.get("account", []):
            if field in account_data:
                result[field] = account_data[field]

        # Extract transaction values
        for field in relevant_fields.get("transaction", []):
            if field in transaction_data:
                result[field] = transaction_data[field]

        return result

    def save_model(self, filename="pkl/incident_model.pkl"):
        """Save the trained model to a file"""
        if not self.trained:
            raise ValueError("Model has not been trained yet")

        # Create directory if it doesn't exist
        os.makedirs(os.path.dirname(filename), exist_ok=True)

        model_data = {
            'vectorizer': self.vectorizer,
            'classifier': self.classifier,
            'mlb': self.mlb,
            'field_names': self.field_names
        }

        with open(filename, 'wb') as f:
            pickle.dump(model_data, f)

    def load_model(self, filename="pkl/incident_model.pkl"):
        """Load a trained model from a file"""
        if not os.path.exists(filename):
            raise FileNotFoundError(f"Model file {filename} not found")

        with open(filename, 'rb') as f:
            model_data = pickle.load(f)

        self.vectorizer = model_data['vectorizer']
        self.classifier = model_data['classifier']
        self.mlb = model_data['mlb']
        self.field_names = model_data['field_names']
        self.trained = True


def train_and_save_model(data_path='data/incidents_data.json'):
    """Train a model on incident data and save it"""
    # Get training data from centralized source
    incidents_data = get_training_data(data_path)

    # Create and train model
    model = IncidentPatternExtractor()
    model.train(incidents_data)

    # Save model for future use
    model.save_model()
    print("Model trained and saved successfully.")


def get_or_train_model():
    """Get a trained model, training only if needed"""
    model = IncidentPatternExtractor()
    try:
        model.load_model()
        print("Loaded existing model")
    except FileNotFoundError:
        print("Model file not found. Training new model...")
        train_and_save_model()
        model.load_model()
    return model


def demonstrate_pattern_extraction():
    """Demonstrate the pattern extraction functionality"""
    # Define a test incident
    incident_description = "Customer reports credit card declined at store in Germany"

    # Get trained model (trains if needed)
    model = get_or_train_model()

    # Predict relevant fields
    relevant_fields = model.predict(incident_description)

    print(f"Incident: {incident_description}")
    print("Relevant fields:")
    for entity, fields in relevant_fields.items():
        if fields:
            print(f"  {entity.capitalize()}: {', '.join(fields)}")


if __name__ == "__main__":
    #demonstrate_pattern_extraction()
    train_and_save_model()