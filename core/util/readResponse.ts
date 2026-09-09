const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;

type ReadableResponseBody = {
  cancel?: () => Promise<void>;
  destroy?: (error?: Error) => void;
  getReader?: () => {
    cancel: () => Promise<void>;
    read: () => Promise<{ done: boolean; value?: Uint8Array }>;
  };
  [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array>;
};

function parseContentLength(response: Response): number | undefined {
  const value = response.headers?.get("content-length");
  if (!value) {
    return undefined;
  }

  const contentLength = Number(value);
  return Number.isFinite(contentLength) && contentLength >= 0
    ? contentLength
    : undefined;
}

function responseTooLargeError(maxBytes: number): Error {
  return new Error(
    `Response body exceeds the ${maxBytes.toLocaleString()} byte limit`,
  );
}

async function cancelBody(
  body: ReadableResponseBody,
  error: Error,
): Promise<void> {
  if (body.cancel) {
    await body.cancel();
  } else {
    body.destroy?.(error);
  }
}

/**
 * Read a response body without allowing a remote endpoint to allocate an
 * unbounded string in the extension host. Supports both Web and Node streams.
 */
export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number = DEFAULT_MAX_RESPONSE_BYTES,
): Promise<string> {
  const contentLength = parseContentLength(response);
  if (contentLength !== undefined && contentLength > maxBytes) {
    throw responseTooLargeError(maxBytes);
  }

  const body = response.body as unknown as ReadableResponseBody | null;
  if (!body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw responseTooLargeError(maxBytes);
    }
    return text;
  }

  const decoder = new TextDecoder();
  let text = "";
  let bytesRead = 0;
  const addChunk = async (chunk: Uint8Array): Promise<void> => {
    bytesRead += chunk.byteLength;
    if (bytesRead > maxBytes) {
      const error = responseTooLargeError(maxBytes);
      await cancelBody(body, error);
      throw error;
    }
    text += decoder.decode(chunk, { stream: true });
  };

  if (body.getReader) {
    const reader = body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) await addChunk(value);
    }
  } else if (body[Symbol.asyncIterator]) {
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      await addChunk(chunk);
    }
  } else {
    // Response implementations without a stream are expected to have already
    // enforced a Content-Length bound above.
    return await response.text();
  }

  return text + decoder.decode();
}

export { DEFAULT_MAX_RESPONSE_BYTES };
