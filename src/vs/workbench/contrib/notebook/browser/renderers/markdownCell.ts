/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { CellViewModel } from 'vs/workbench/contrib/notebook/browser/renderers/cellViewModel';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { getResizesObserver } from 'vs/workbench/contrib/notebook/browser/renderers/sizeObserver';
import { CELL_MARGIN, EDITOR_TOP_PADDING, EDITOR_BOTTOM_PADDING } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookEditor, CellRenderTemplate } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { raceCancellation } from 'vs/base/common/async';

export class StatefullMarkdownCell extends Disposable {
	private editor: CodeEditorWidget | null = null;
	private cellContainer: HTMLElement;
	private editingContainer?: HTMLElement;

	private localDisposables: DisposableStore;

	constructor(
		notebookEditor: INotebookEditor,
		public viewCell: CellViewModel,
		templateData: CellRenderTemplate,
		editorOptions: IEditorOptions,
		instantiationService: IInstantiationService
	) {
		super();

		this.cellContainer = templateData.cellContainer;
		this.editingContainer = templateData.editingContainer;
		this.localDisposables = new DisposableStore();
		this._register(this.localDisposables);

		const viewUpdate = () => {
			if (viewCell.isEditing) {
				// switch to editing mode
				let width: number;
				const listDimension = notebookEditor.getListDimension();
				if (listDimension) {
					width = listDimension.width - CELL_MARGIN * 2;
				} else {
					width = this.cellContainer.clientWidth - 24 /** for scrollbar and margin right */;
				}

				const lineNum = viewCell.lineCount;
				const lineHeight = notebookEditor.getFontInfo()?.lineHeight ?? 18;
				const totalHeight = Math.max(lineNum, 1) * lineHeight + EDITOR_TOP_PADDING + EDITOR_BOTTOM_PADDING;

				if (this.editor) {
					// not first time, we don't need to create editor or bind listeners
					this.editingContainer!.style.display = 'block';
					viewCell.attachTextEditor(this.editor!);
					if (notebookEditor.getActiveCell() === viewCell) {
						this.editor!.focus();
					}
				} else {
					this.editingContainer!.style.display = 'block';
					this.editingContainer!.innerHTML = '';
					this.editor = instantiationService.createInstance(CodeEditorWidget, this.editingContainer!, {
						...editorOptions,
						dimension: {
							width: width,
							height: totalHeight
						}
					}, {});


					const cts = new CancellationTokenSource();
					this._register({ dispose() { cts.dispose(true); } });
					raceCancellation(viewCell.resolveTextModel(), cts.token).then(model => {
						if (!model) {
							return;
						}

						this.editor!.setModel(model);
						viewCell.attachTextEditor(this.editor!);
						if (notebookEditor.getActiveCell() === viewCell) {
							this.editor!.focus();
						}

						const realContentHeight = this.editor!.getContentHeight();
						if (realContentHeight !== totalHeight) {
							this.editor!.layout(
								{
									width: width,
									height: realContentHeight
								}
							);
						}

						this.localDisposables.add(model.onDidChangeContent(() => {
							viewCell.setText(model.getLinesContent());
							let clientHeight = this.cellContainer.clientHeight;
							this.cellContainer.innerHTML = '';
							let renderedHTML = viewCell.getHTML();
							if (renderedHTML) {
								this.cellContainer.appendChild(renderedHTML);
								clientHeight = this.cellContainer.clientHeight;
							}

							notebookEditor.layoutNotebookCell(viewCell, this.editor!.getContentHeight() + 32 + clientHeight);
						}));

						if (viewCell.isEditing) {
							this.editor!.focus();
						}
					});

					this.localDisposables.add(this.editor.onDidContentSizeChange(e => {
						let viewLayout = this.editor!.getLayoutInfo();

						if (e.contentHeightChanged) {
							this.editor!.layout(
								{
									width: viewLayout.width,
									height: e.contentHeight
								}
							);
							const clientHeight = this.cellContainer.clientHeight;
							notebookEditor.layoutNotebookCell(viewCell, e.contentHeight + 32 + clientHeight);
						}
					}));

					let cellWidthResizeObserver = getResizesObserver(templateData.editingContainer!, {
						width: width,
						height: totalHeight
					}, () => {
						let newWidth = cellWidthResizeObserver.getWidth();
						let realContentHeight = this.editor!.getContentHeight();
						this.editor!.layout(
							{
								width: newWidth,
								height: realContentHeight
							}
						);
					});

					cellWidthResizeObserver.startObserving();
					this.localDisposables.add(cellWidthResizeObserver);

					let markdownRenderer = viewCell.getMarkdownRenderer();
					this.cellContainer.innerHTML = '';
					let renderedHTML = viewCell.getHTML();
					if (renderedHTML) {
						this.cellContainer.appendChild(renderedHTML);
						this.localDisposables.add(markdownRenderer.onDidUpdateRender(() => {
							const clientHeight = this.cellContainer.clientHeight;
							notebookEditor.layoutNotebookCell(viewCell, clientHeight);
						}));
					}
				}

				const clientHeight = this.cellContainer.clientHeight;
				notebookEditor.layoutNotebookCell(viewCell, totalHeight + 32 + clientHeight);
				this.editor.focus();
			} else {
				this.viewCell.detachTextEditor();
				if (this.editor) {
					// switch from editing mode
					this.editingContainer!.style.display = 'none';
					const clientHeight = this.cellContainer.clientHeight;
					notebookEditor.layoutNotebookCell(viewCell, clientHeight);
				} else {
					// first time, readonly mode
					this.editingContainer!.style.display = 'none';

					this.cellContainer.innerHTML = '';
					let markdownRenderer = viewCell.getMarkdownRenderer();
					let renderedHTML = viewCell.getHTML();
					if (renderedHTML) {
						this.cellContainer.appendChild(renderedHTML);
					}

					this.localDisposables.add(markdownRenderer.onDidUpdateRender(() => {
						const clientHeight = this.cellContainer.clientHeight;
						notebookEditor.layoutNotebookCell(viewCell, clientHeight);
					}));
				}
			}
		};

		this._register(viewCell.onDidChangeEditingState(() => {
			this.localDisposables.clear();
			viewUpdate();
		}));

		viewUpdate();
	}

	dispose() {
		this.viewCell.detachTextEditor();
		super.dispose();
	}
}
