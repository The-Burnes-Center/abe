# Pinned by digest (the multi-arch manifest list for python:3.12) so rebuilds
# don't silently pick up a new base. Refresh with:
#   docker buildx imagetools inspect public.ecr.aws/lambda/python:3.12
FROM public.ecr.aws/lambda/python:3.14@sha256:208b9b8e1a2277d4f8e0dbe3073f846d47919300a69584864f9f8f9c112ad5b4


# Copy function code
COPY lambda_function.py ${LAMBDA_TASK_ROOT}

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --target "${LAMBDA_TASK_ROOT}"

# Download nltk data if required for BLEU score
RUN python -m nltk.downloader -q -d ${LAMBDA_TASK_ROOT}/nltk_data punkt punkt_tab

# Set the CMD to your handler (function name)
CMD ["lambda_function.lambda_handler"]
