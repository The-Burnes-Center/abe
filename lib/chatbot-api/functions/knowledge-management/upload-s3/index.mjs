// Import necessary modules from AWS SDK for S3 interaction
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { isAdmin, forbidden } from './auth.mjs';

const URL_EXPIRATION_SECONDS = 300;

// Restrict admin uploads to a single allowlisted prefix and a safe character
// set so an admin token cannot overwrite system-managed keys like
// `metadata.txt` or `indexes/.../latest.xlsx`.
// Allows the same character set as source-presign so any file that can be
// uploaded can also be served back. Parens are common in browser/OS dedupe
// suffixes (e.g. "Document (8).pdf"); comma/ampersand/plus appear in real
// messy real-world filenames ("Smith, J.pdf", "Q&A Notes.pdf").
const SAFE_FILENAME = /^[a-zA-Z0-9._\-/ ()&,+]+$/;
const SAFE_CHAR = /[a-zA-Z0-9._\-/ ()&,+]/;
const ALLOWED_DESCRIPTION = 'letters, numbers, spaces, and these symbols: ( ) & , + . _ - /';

// Main Lambda entry point
export const handler = async (event) => {
  if (!isAdmin(event)) {
    return forbidden();
  }
  return await getUploadURL(event); //Call the helper function
};

//Helper function to generate a presigned upload URL for S3
const getUploadURL = async function (event) {
  const body = JSON.parse(event.body); //Parse the incoming request body
  const fileName = body.fileName; //Retrieve the file name
  const fileType = body.fileType; //Retrieve the file type

  if (!fileName || typeof fileName !== "string") {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Filename is required.' }),
    };
  }
  if (fileName.includes("..")) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Filename cannot contain ".." for path-traversal safety.' }),
    };
  }
  if (!SAFE_FILENAME.test(fileName)) {
    const badChars = [...new Set([...fileName].filter((c) => !SAFE_CHAR.test(c)))]
      .map((c) => `"${c}"`)
      .join(', ');
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        error: `Filename contains characters that aren't allowed: ${badChars}. Use only ${ALLOWED_DESCRIPTION}.`,
      }),
    };
  }
  // Block writes to system-managed keys at the bucket root and to the Excel
  // index path so an admin cannot clobber the chat metadata file or replace a
  // live index file outside the normal index management API.
  const normalized = fileName.replace(/^\/+/, "");
  if (normalized === "metadata.txt" || normalized.startsWith("indexes/")) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Key not allowed' }),
    };
  }

  const s3Params = { //Parameters for S3 PutObjectCommand
    Bucket: process.env.BUCKET, //S3 bucket name for environment
    Key: normalized, //S3 object key (filename)
    ContentType: fileType, //MIME type of the file

  };

  const s3 = new S3Client({}); // region comes from AWS_REGION, so URLs are signed for the bucket's region
  const command = new PutObjectCommand(s3Params); //Create PutObjectCommand with given params

  try {
    const signedUrl = await getSignedUrl(s3, command, {
      expiresIn: URL_EXPIRATION_SECONDS, //Set URL expiration time
    });
    return {
      statusCode: 200, 
      headers: {
            'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ signedUrl }),
    };
  } catch (err) {
    return {
      statusCode: 500,
       headers: {
            'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Failed to generate signed URL' }),
    };
  }
};


