// Lightweight monaco-editor stub used only in tests to avoid resolving the
// full monaco-editor package which has complex exports and worker setup.

// Provide the minimal surface the app expects: an editor object with
// create, editor, languages, Range, KeyCode, KeyMod, etc., used in tests.

const Range = function (sL, sC, eL, eC) {
  this.startLineNumber = sL;
  this.startColumn = sC;
  this.endLineNumber = eL;
  this.endColumn = eC;
};

const KeyCode = {
  Enter: 1,
  KeyC: 2,
  Backslash: 3
};

const KeyMod = {
  Shift: 1 << 10,
  Alt: 1 << 11,
  CtrlCmd: 1 << 12,
  Ctrl: 1 << 12,
  Meta: 1 << 13
};

const languages = {
  registerDocumentFormattingEditProvider() {
    return { dispose: () => {} };
  },
  json: {
    jsonDefaults: {
      setDiagnosticsOptions() {}
    }
  }
};

const editor = {
  create() {
    return {
      getModel: () => ({ getValue: () => '{}', pushEditOperations: () => {}, getValueInRange: () => '{}' }),
      getValue: () => '{}',
      getSelections: () => [],
      onDidChangeModelContent: () => {},
      onKeyDown: () => {},
      addCommand: () => {},
      addAction: () => {},
      getAction: () => ({ run: async () => {} }),
      dispose: () => {},
      getDomNode: () => null,
      focus: () => {}
    };
  },
  defineTheme: () => {},
  setTheme: () => {}
};

export { Range, KeyCode, KeyMod, languages, editor };

export default { Range, KeyCode, KeyMod, languages, editor };
