# Pinned by digest (the multi-arch manifest list for python:3.12) so rebuilds
# don't silently pick up a new base. Refresh with:
#   docker buildx imagetools inspect public.ecr.aws/lambda/python:3.12
FROM public.ecr.aws/lambda/python:3.12@sha256:517bcc7dc1a3ba62e324961c1563cc54a2bd6dc1060188f9d376211ecb7b2926


# Copy function code
COPY lambda_function.py ${LAMBDA_TASK_ROOT}

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --target "${LAMBDA_TASK_ROOT}"

# Download nltk data if required for BLEU score
RUN python -m nltk.downloader -q -d ${LAMBDA_TASK_ROOT}/nltk_data punkt punkt_tab

# Set the CMD to your handler (function name)
CMD ["lambda_function.lambda_handler"]
