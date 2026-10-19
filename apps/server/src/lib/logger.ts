import pino from 'pino';

/** C-19: transcripts, email bodies and contact details never reach the logs. */
export const REDACT_PATHS = [
  'transcript',
  '*.transcript',
  'text',
  '*.text',
  'utterance',
  '*.utterance',
  'body',
  '*.body',
  'email.body',
  'contact.email',
  '*.email',
  'email',
  'phone',
  '*.phone',
  'req.headers.authorization',
  'OPENAI_API_KEY',
  '*.OPENAI_API_KEY',
  'apiKey',
  '*.apiKey',
];

export function createLogger(level = 'info', destination?: pino.DestinationStream) {
  return pino(
    {
      level,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      base: { service: 'sherpa-server' },
    },
    destination,
  );
}
export type Logger = ReturnType<typeof createLogger>;
