# Editing APL files in VS Code

`make vscode-apl` writes `schemas/apl_rotation.schema.json` from the generated protos, and
`.vscode/settings.json` gives it to every `*.apl.json` file: the JSON editor completes field, kind and enum
names and marks a name the proto does not have. The same command builds the APL panel, which shows the
rotation beside the JSON and edits it; see `tools/vscode-apl/README.md`.

Create an APL file named `myrotation.apl.json`, replacing `myrotation` with whatever name you prefer. An
empty rotation looks like

```
{
    "type": "TypeAPL",
    "prepullActions": [],
    "priorityList": []
}
```

You can then add prepull actions and the main priority list.
