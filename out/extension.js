'use strict'

const vscode = require('vscode')
const isWindows = process.platform === 'win32'


function activate(context) {
    const defaultLFSymbol   = '↓'
    const defaultCRSymbol   = '←'
    const defaultCRLFSymbol = '↵'
    const LF = 1
    const CRLF = 2

    // decorations
    var eolDecorationTypes = {}
    var extraWhitespaceDecorationTypes = {}

    // to determine if decoration types need recreation
    var lastEolSymbol = null
    var lastThemeColorError = null
    var lastThemeColorWhitespace = null
    var lastDecorationBeforeEof = null

    // settings
    var defaultRenderWhitespace
    var defaultEol
    var defaultSymbolLF
    var defaultSymbolCR
    var defaultSymbolCRLF
    var defaultHighlightNonDefault
    var defaultHighlightExtraWhitespace
    var defaultDecorateBeforeEol

    function renderDecorations(editor, ranges) {
        if (!editor) { return }

        const document = editor.document

        const [ renderWhitespace, eol, symbolLF, symbolCRLF, highlightNonDefault, highlightExtraWhitespace, decorateBeforeEol ]
            = getDocumentSettings(editor.document)
        const shouldRenderEOL = (renderWhitespace !== 'none') && (renderWhitespace !== 'boundary')
        const shouldRenderOnlySelection = (renderWhitespace === 'selection')

        const lineEnding = document.eol

        let currentEolSymbol
        let nonDefaultLineEnding = false
        if (lineEnding == LF) {
            currentEolSymbol = symbolLF
            nonDefaultLineEnding = (eol != '\n')
        } else if (lineEnding == CRLF) {
            currentEolSymbol = symbolCRLF
            nonDefaultLineEnding = (eol != '\r\n')
        }

        //checking on every call as there is no theme change event
        const themeColorError = new vscode.ThemeColor('errorForeground')
        const themeColorWhitespace = new vscode.ThemeColor('editorWhitespace.foreground')
        const eolColor = highlightNonDefault && nonDefaultLineEnding ? themeColorError : themeColorWhitespace

        let eolDecorationType = (editor.id in eolDecorationTypes) ? eolDecorationTypes[editor.id] : null
        if ((eolDecorationType == null) || (lastEolSymbol !== currentEolSymbol) || (lastThemeColorError !== themeColorError) || (lastThemeColorWhitespace !== themeColorWhitespace) || (lastDecorationBeforeEof !== decorateBeforeEol)) {
            if (eolDecorationType != null) {
                if (editor.setDecorations) { editor.setDecorations(eolDecorationType, []) }
                eolDecorationType.dispose()
            }
            if (decorateBeforeEol) {
                eolDecorationType = vscode.window.createTextEditorDecorationType({ before: { contentText: currentEolSymbol, color: eolColor } })
            } else {
                eolDecorationType = vscode.window.createTextEditorDecorationType({ after: { contentText: currentEolSymbol, color: eolColor } })
            }
            lastEolSymbol = currentEolSymbol
            lastThemeColorError = themeColorError
            lastThemeColorWhitespace = themeColorWhitespace
            lastDecorationBeforeEof = decorateBeforeEol
        }
        eolDecorationTypes[editor.id] =  eolDecorationType

        let extraWhitespaceDecorationType = (editor.id in extraWhitespaceDecorationTypes) ? extraWhitespaceDecorationTypes[editor.id] : null
        if ((extraWhitespaceDecorationType == null) || (lastThemeColorError !== themeColorError)) {
            if (extraWhitespaceDecorationType != null) {
                if (editor.setDecorations) { editor.setDecorations(extraWhitespaceDecorationType, []) }
                extraWhitespaceDecorationType.dispose()
            }
            extraWhitespaceDecorationType = vscode.window.createTextEditorDecorationType({ color: themeColorError })
            lastThemeColorError = themeColorError
        }
        extraWhitespaceDecorationTypes[editor.id] =  extraWhitespaceDecorationType

        var eolDecorations = []
        var extraWhitespaceDecorations = []
        if (shouldRenderEOL) {
            const selections = editor.selections

            //determine what is exactly visible
            let visibleRanges = (ranges == null) ? editor.visibleRanges : ranges
            let startOffset = document.offsetAt(visibleRanges[0].start)
            let endOffset = document.offsetAt(visibleRanges[0].end)
            for(let i=1; i<visibleRanges.length; i++) {
                let nextStartOffset = document.offsetAt(visibleRanges[i].start)
                let nextEndOffset = document.offsetAt(visibleRanges[i].end)
                if (startOffset > nextStartOffset) { startOffset = nextStartOffset }
                if (endOffset < nextEndOffset) { endOffset = nextEndOffset }
            }

            let startPosition = document.positionAt(startOffset)
            let endPosition = document.positionAt(endOffset)

            let startLine = Number(document.lineAt(startPosition).lineNumber)
            let endLine = Number(document.validatePosition(endPosition.translate(2, 0)).line)
            if (startLine > 0) { startLine -= 1 } //in case of partial previous line

            for (let i=startLine; i<=endLine; i++) {
                var line = document.lineAt(i)
                if (i != endLine) {
                    const eolPosition = line.range.end
                    let shouldDecorate = false
                    if (shouldRenderOnlySelection) { //check if decoration falls within selection
                        if ((selections !== null) && selections.length > 0) {
                            selections.forEach(selection => { //check each selection
                                const hasSelection = (selection.start.line !== selection.end.line) || (selection.start.character !== selection.end.character)
                                if (hasSelection && eolPosition.isAfterOrEqual(selection.start) && eolPosition.isBeforeOrEqual(selection.end)) {
                                    shouldDecorate = true
                                    return
                                }
                            })
                        }
                    } else { //decorate all
                        shouldDecorate = true
                    }
                    if (shouldDecorate && decorateBeforeEol && (line.text.length == 0)) {
                        shouldDecorate = false //don't decorate empty lines to avoid wrong cursor positioning when 'before' decoration is used
                    }
                    if (shouldDecorate) {
                        eolDecorations.push({
                            range: new vscode.Range(eolPosition, eolPosition)
                        })
                    }
                }
                if (highlightExtraWhitespace) {
                    const lastWhitespace = line.text.search('\\s+$')
                    if (lastWhitespace >= 0) {
                        extraWhitespaceDecorations.push({
                            range: new vscode.Range(new vscode.Position(line.range.end.line, lastWhitespace), line.range.end)
                        })
                    }
                }
            }
        }

        if (editor.setDecorations) { editor.setDecorations(eolDecorationType, eolDecorations) }
        if (editor.setDecorations && highlightExtraWhitespace) { editor.setDecorations(extraWhitespaceDecorationType, extraWhitespaceDecorations) }
    }

    function updateConfiguration() {
        let anyChanges = false

        const editorConfiguration = vscode.workspace.getConfiguration('editor', null)
        const newDefaultRenderWhitespace = editorConfiguration.get('renderWhitespace', 'none') || 'selection'

        const filesConfiguration = vscode.workspace.getConfiguration('files', null)
        const newDefaultEol = filesConfiguration.get('eol', 'auto') || 'auto'

        const customConfiguration = vscode.workspace.getConfiguration('code-eol', null)
        const newDefaultSymbolLF =   customConfiguration.get('newlineCharacter', defaultLFSymbol)   || defaultLFSymbol
        const newDefaultSymbolCR =   customConfiguration.get('returnCharacter',  defaultCRSymbol)   || defaultCRSymbol
        const newDefaultSymbolCRLF = customConfiguration.get('crlfCharacter',    defaultCRLFSymbol) || defaultCRLFSymbol
        const newDefaultHighlightNonDefault = customConfiguration.get('highlightNonDefault', false)
        const newDefaultHighlightExtraWhitespace = customConfiguration.get('highlightExtraWhitespace', false)
        const newDefaultDecorateBeforeEol = customConfiguration.get('decorateBeforeEol', false)

        if (defaultRenderWhitespace !== newDefaultRenderWhitespace) {
            defaultRenderWhitespace = newDefaultRenderWhitespace
            anyChanges = true
        }

        if (defaultEol !== newDefaultEol) {
            defaultEol = newDefaultEol
            anyChanges = true
        }

        if (defaultSymbolLF !== newDefaultSymbolLF) {
            defaultSymbolLF = newDefaultSymbolLF
            anyChanges = true
        }
        if (defaultSymbolCR !== newDefaultSymbolCR) {
            defaultSymbolCR = newDefaultSymbolCR
            anyChanges = true
        }
        if (defaultSymbolCRLF !== newDefaultSymbolCRLF) {
            defaultSymbolCRLF = newDefaultSymbolCRLF
            anyChanges = true
        }
        if (defaultHighlightNonDefault !== newDefaultHighlightNonDefault) {
            defaultHighlightNonDefault = newDefaultHighlightNonDefault
            anyChanges = true
        }
        if (defaultHighlightExtraWhitespace !== newDefaultHighlightExtraWhitespace) {
            defaultHighlightExtraWhitespace = newDefaultHighlightExtraWhitespace
            anyChanges = true
        }
        if (defaultDecorateBeforeEol !== newDefaultDecorateBeforeEol) {
            defaultDecorateBeforeEol = newDefaultDecorateBeforeEol
            anyChanges = true
        }

        return anyChanges
    }


    function getDocumentSettings(document) {
        let renderWhitespace = defaultRenderWhitespace
        let eol = defaultEol
        let symbolLF = defaultSymbolLF
        //let symbolCR = defaultSymbolCR
        let symbolCRLF = defaultSymbolCRLF
        let highlightNonDefault = defaultHighlightNonDefault
        let highlightExtraWhitespace = defaultHighlightExtraWhitespace
        let decorateBeforeEol = defaultDecorateBeforeEol

        const languageId = document.languageId
        if (languageId) {
            const languageSpecificConfiguration = vscode.workspace.getConfiguration('[' + languageId + ']', null)
            if (languageSpecificConfiguration !== null) {

                const languageSpecificRenderWhitespace = languageSpecificConfiguration['editor.renderWhitespace']
                if (languageSpecificRenderWhitespace) { renderWhitespace = languageSpecificRenderWhitespace }

                const languageSpecificEol = languageSpecificConfiguration['files.eol']
                if (languageSpecificEol) { eol = languageSpecificEol }

                const languageSpecificSymbolLF = languageSpecificConfiguration['code-eol.newlineCharacter']
                if (languageSpecificSymbolLF) { symbolLF = languageSpecificSymbolLF }

                //const languageSpecificSymbolCR = languageSpecificConfiguration['code-eol.returnCharacter']
                //if (languageSpecificSymbolCR) { symbolCR = languageSpecificSymbolCR }

                const languageSpecificSymbolCRLF = languageSpecificConfiguration['code-eol.crlfCharacter']
                if (languageSpecificSymbolCRLF) { symbolCRLF = languageSpecificSymbolCRLF }

                const languageSpecificHighlightNonDefault = languageSpecificConfiguration['code-eol.highlightNonDefault']
                if (languageSpecificHighlightNonDefault) { highlightNonDefault = languageSpecificHighlightNonDefault }

                const languageSpecificHighlightExtraWhitespace = languageSpecificConfiguration['code-eol.highlightExtraWhitespace']
                if (languageSpecificHighlightExtraWhitespace) { highlightExtraWhitespace = languageSpecificHighlightExtraWhitespace }

                const languageSpecificDecorateBeforeEol = languageSpecificConfiguration['code-eol.decorateBeforeEol']
                if (languageSpecificDecorateBeforeEol) { decorateBeforeEol = languageSpecificDecorateBeforeEol }

            }
        }

        if (eol === 'auto') { eol = isWindows ? '\r\n' : '\n' }

        return [ renderWhitespace, eol, symbolLF, symbolCRLF, highlightNonDefault, highlightExtraWhitespace, decorateBeforeEol ]
    }


    updateConfiguration()
    renderDecorations(vscode.window.activeTextEditor)


    vscode.window.onDidChangeActiveTextEditor((e) => {
        renderDecorations(e)
    }, null, context.subscriptions)

    vscode.window.onDidChangeTextEditorSelection((e) => {
        if ((e.textEditor != null) && (e.textEditor.document != null) && (e.selections.length > 0)) {
            renderDecorations(e.textEditor)
        }
    }, null, context.subscriptions)

    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
        if ((e.textEditor != null) && (e.textEditor.document != null) && (e.visibleRanges.length > 0)) {
            renderDecorations(e.textEditor, e.visibleRanges)
        }
    }, null, context.subscriptions)

    vscode.window.onDidChangeVisibleTextEditors((e) => {
        e.forEach(editor => {
            renderDecorations(editor)
        })
    }, null, context.subscriptions)


    vscode.workspace.onDidChangeConfiguration(() => {
        updateConfiguration()
        renderDecorations(vscode.window.activeTextEditor)
    }, null, context.subscriptions)

    vscode.workspace.onDidChangeTextDocument(() => {
        renderDecorations(vscode.window.activeTextEditor)
    }, null, context.subscriptions)
}
exports.activate = activate


function deactivate() {
}
exports.deactivate = deactivate
