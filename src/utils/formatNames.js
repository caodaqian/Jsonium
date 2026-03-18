export function getFormatName(format) {
  const names = {
    // common short names
    json: 'JSON',
    json5: 'JSON5',
    yaml: 'YAML',
    xml: 'XML',
    escaped: '转义字符串',
    base64: 'Base64',
    // formatDetector canonical keys
    escaped_json: '转义字符串'
  };

  return names[format] || format;
}