import { z } from 'zod';

/**
 * The request of a manual update, shared by the remote api and the settings screen.
 * Published versions only: the value reaches a release url, and a prerelease suffix or a
 * stray path is not something an update endpoint installs.
 */
const zUpdateRequest = z.object({
  targetVersion: z
    .string()
    .trim()
    .regex(/^\d+\.\d+\.\d+$/)
    .optional(),
  allowDowngrade: z.boolean().optional()
});

type TUpdateRequestInput = z.infer<typeof zUpdateRequest>;

export { zUpdateRequest, type TUpdateRequestInput };
