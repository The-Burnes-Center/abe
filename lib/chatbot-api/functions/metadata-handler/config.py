# config.py

# Categories and their descriptions
CATEGORIES = {
    'user guide': 'A document that provides step-by-step instructions on how to purchase for a specific contract.',
    'handbook': 'A comprehensive reference document that covers various aspects of OSD Procurement',
    'swc index': 'Contains a list telling what contracts are available and who manages them.',
    'unknown': 'Documents that do not clearly fit into any of the above categories.'
}

# Additional custom tags
CUSTOM_TAGS = {
    'complexity': ['low', 'medium', 'high'],
    'author':[]
}

# Tag descriptions
TAG_DESCRIPTIONS = {
    'category': 'The type of document',
    'complexity': 'Indicates how complex the document is to understand for a new buyer for state.',
    'author': 'The Author of the document'
}


def get_all_tags():
    return {**{'category': list(CATEGORIES.keys())}, **CUSTOM_TAGS}


def get_full_prompt(content):
    all_tags = get_all_tags()

    prompt = f"""Analyze the following document and provide:
1. A summary of about 100 words.
2. Appropriate tags from the following options:

"""

    for tag, values in all_tags.items():
        prompt += f"{tag}: {', '.join(values)}\n"
        if tag in TAG_DESCRIPTIONS:
            prompt += f"   Description: {TAG_DESCRIPTIONS[tag]}\n"

    prompt += f"""
Provide your response in JSON format with keys 'summary' and 'tags', where 'tags' is an object containing the selected tags.

Document: {content}"""

    return prompt