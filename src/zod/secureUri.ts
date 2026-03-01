import * as z from "zod";

// Define the allowed schemes (protocols).
// Note: The native URL API includes the colon ':' in the protocol string.
const ALLOWED_PROTOCOLS = ["https:", "http:"];

export const SafeUriSchema = z
    .string()
    // 1. Basic structural check: Is it a string that looks like a URI?
    .url({ message: "Invalid URL format." })
    // 2. Security refinement: Is the protocol safe?
    .refine(
        (uriString) => {
            try {
                const url = new URL(uriString);
                return ALLOWED_PROTOCOLS.includes(url.protocol);
            } catch (e) {
                // If the native URL parser fails, reject it.
                return false;
            }
        },
        {
            message: `Security Error: Only ${ALLOWED_PROTOCOLS.join(", ")} protocols are allowed.`,
        }
    );
