module.exports = [
  { type: 'heading', defaultValue: 'Golemio PID — Settings' },

  // Více zastávek: odděl čárkou, středníkem nebo novým řádkem
  {
    type: 'input',
    messageKey: 'STOPS',
    label: 'Stops (comma / newline separated)',
    defaultValue: 'Sídliště Lhotka, Kačerov, Anděl',
    attributes: { placeholder: 'e.g. Sídliště Lhotka, Kačerov' }
  },

  { type: 'input',  messageKey: 'API_KEY', label: 'Golemio API key', defaultValue: '' },
  { type: 'slider', messageKey: 'LIMIT',   label: 'Number of departures', defaultValue: 5, min: 1, max: 10, step: 1 },

  // Velikost písma: 0 = large (výchozí), 1 = small (compact)
  {
    type: 'select',
    messageKey: 'FONT_SMALL',
    label: 'Text size',
    defaultValue: '0',
    options: [
      { label: 'Large (default)', value: '0' },
      { label: 'Small / compact', value: '1' }
    ]
  },

  { type: 'submit', defaultValue: 'Save settings' }
];
