import re

def preprocess_text(text: str) -> str:
    """Basic text cleaner to remove excessive whitespace and normalize."""
    text = re.sub(r'\s+', ' ', text)
    return text.strip()
