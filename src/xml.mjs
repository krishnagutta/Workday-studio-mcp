import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  ignoreAttributes: false,
});

export function validateXml(content) {
  try {
    parser.parse(content, true);
    return { valid: true, errors: [] };
  } catch (e) {
    const message = e.message || String(e);
    const lineMatch = message.match(/Line (\d+)/i);
    const colMatch = message.match(/Col (\d+)/i);
    return {
      valid: false,
      errors: [{
        line: lineMatch ? parseInt(lineMatch[1]) : null,
        column: colMatch ? parseInt(colMatch[1]) : null,
        message,
      }],
    };
  }
}
