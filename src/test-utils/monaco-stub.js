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
  KeyF: 2,
  KeyC: 3,
  KeyJ: 4,
  Backslash: 5
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
    const instance = {
      commands: [],
      actions: [],
      getModel: () => ({ getValue: () => '{}', pushEditOperations: () => {}, getValueInRange: () => '{}' }),
      getValue: () => '{}',
      getSelections: () => [],
      onDidChangeModelContent: () => {},
      onKeyDown: () => {},
      addCommand: (keybinding, handler) => { instance.commands.push({ keybinding, handler }); },
      addAction: (action) => { instance.actions.push(action); },
      getAction: () => ({ run: async () => {} }),
      dispose: () => {},
      getDomNode: () => null,
      focus: () => {}
    };
    globalThis.__monacoLastEditor = instance;
    return instance;
  },
  defineTheme: () => {},
  setTheme: () => {}
};

export { Range, KeyCode, KeyMod, languages, editor };

export default { Range, KeyCode, KeyMod, languages, editor };
