'use strict';

import * as vscode from 'vscode';
import OpenAI from 'openai';

let commentId = 1;

class NoteComment implements vscode.Comment {
	id: number;
	label: string | undefined;
	savedBody: string | vscode.MarkdownString; // for the Cancel button
	constructor(
		public body: string | vscode.MarkdownString,
		public mode: vscode.CommentMode,
		public author: vscode.CommentAuthorInformation,
		public parent?: vscode.CommentThread,
		public contextValue?: string
	) {
		this.id = ++commentId;
		this.savedBody = this.body;
	}
}

/**
 * Shows an input box for getting API key using window.showInputBox().
 * Checks if inputted API Key is valid.
 * Updates the User Settings API Key with the newly inputted API Key.
 */
export async function showInputBox() {
	const result = await vscode.window.showInputBox({
		ignoreFocusOut: true,
		placeHolder: 'Your OpenAI API Key',
		title: 'Scribe AI',
		prompt: 'You have not set your OpenAI API key yet or your API key is incorrect, please enter your API key to use the ScribeAI extension.',
		validateInput: async text => {
			vscode.window.showInformationMessage(`Validating: ${text}`);
			if (text === '') {
				return 'The API Key can not be empty';
			}
			try {
				const openai = new OpenAI({
					apiKey: vscode.workspace.getConfiguration('scribeai').get('ApiKey'),
				});
				await openai.models.list();
			} catch (err) {
				return 'Your API key is invalid';
			}
			return null;
		}
	});
	vscode.window.showInformationMessage(`Got: ${result}`);
	// Write to user settings
	await vscode.workspace.getConfiguration('scribeai').update('ApiKey', result, true);
	// Write to workspace settings
	//await vscode.workspace.getConfiguration('scribeai').update('ApiKey', result, false);
	return result;
}

async function validateAPIKey() {
	try {
		const openai = new OpenAI({
			apiKey: vscode.workspace.getConfiguration('scribeai').get('ApiKey'),
		});
		await openai.models.list();
	} catch (err) {
		return false;
	}
	return true;
}

export async function activate(context: vscode.ExtensionContext) {
	// Workspace settings override User settings when getting the setting.
	if (vscode.workspace.getConfiguration('scribeai').get('ApiKey') === ""
		|| !(await validateAPIKey())) {
		const apiKey = await showInputBox();
	}
	const openai = new OpenAI({
		apiKey: vscode.workspace.getConfiguration('scribeai').get('ApiKey'),
	});

	// A `CommentController` is able to provide comments for documents.
	const commentController = vscode.comments.createCommentController('comment-scribeai', 'ScribeAI Comment Controller');
	context.subscriptions.push(commentController);

	// A `CommentingRangeProvider` controls where gutter decorations that allow adding comments are shown
	commentController.commentingRangeProvider = {
		provideCommentingRanges: (document: vscode.TextDocument, token: vscode.CancellationToken) => {
			const lineCount = document.lineCount;
			return [new vscode.Range(0, 0, lineCount - 1, 0)];
		}
	};

	commentController.options = {
		prompt: "让爱可帮来帮帮你吧 👉",
		placeHolder: "尽情提出你对爱可帮的需求吧，看看它是否会给你一个惊喜，😇"
	};

	context.subscriptions.push(vscode.commands.registerCommand('mywiki.createNote', (reply: vscode.CommentReply) => {
		replyNote(reply);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('mywiki.askAI', (reply: vscode.CommentReply) => {
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "生成答复中……",
			cancellable: true
		}, async () => {
			await askAI(reply);
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('mywiki.aiEdit', (reply: vscode.CommentReply) => {
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "生成答复中……",
			cancellable: true
		}, async () => {
			await aiEdit(reply);
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('mywiki.extendDocString', (reply: vscode.CommentReply) => {
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "生成答复中……",
			cancellable: true
		}, async () => {
			reply.text = "帮我扩展草稿文本 👉";
			await aiEdit(reply);
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('mywiki.replyNote', (reply: vscode.CommentReply) => {
		replyNote(reply);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('mywiki.deleteNoteComment', (comment: NoteComment) => {
		const thread = comment.parent;
		if (!thread) {
			return;
		}

		thread.comments = thread.comments.filter(cmt => (cmt as NoteComment).id !== comment.id);

		if (thread.comments.length === 0) {
			thread.dispose();
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('mywiki.deleteNote', (thread: vscode.CommentThread) => {
		thread.dispose();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('mywiki.cancelsaveNote', (comment: NoteComment) => {
		if (!comment.parent) {
			return;
		}

		comment.parent.comments = comment.parent.comments.map(cmt => {
			if ((cmt as NoteComment).id === comment.id) {
				cmt.body = (cmt as NoteComment).savedBody;
				cmt.mode = vscode.CommentMode.Preview;
			}

			return cmt;
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('mywiki.saveNote', (comment: NoteComment) => {
		if (!comment.parent) {
			return;
		}

		comment.parent.comments = comment.parent.comments.map(cmt => {
			if ((cmt as NoteComment).id === comment.id) {
				(cmt as NoteComment).savedBody = cmt.body;
				cmt.mode = vscode.CommentMode.Preview;
			}

			return cmt;
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('mywiki.editNote', (comment: NoteComment) => {
		if (!comment.parent) {
			return;
		}

		comment.parent.comments = comment.parent.comments.map(cmt => {
			if ((cmt as NoteComment).id === comment.id) {
				cmt.mode = vscode.CommentMode.Editing;
			}

			return cmt;
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('mywiki.dispose', () => {
		commentController.dispose();
	}));


	/**
	 * Gets the highlighted code for this comment thread
	 * @param thread
	 * @returns
	 */
	async function getCommentThreadCode(thread: vscode.CommentThread) {
		const document = await vscode.workspace.openTextDocument(thread.uri);
		// Get selected code for the comment thread
		return document.getText(thread.range).trim();
	}

	/**
	 * Generates the prompt to pass to OpenAI API.
	 * Prompt includes:
	 * - Role play text that gives context to AI
	 * - Code block highlighted for the comment thread
	 * - All past conversation history + example conversation
	 * - User's new question
	 * @param question
	 * @param thread
	 * @returns
	 */
	async function generatePromptOpenAI(question: string, thread: vscode.CommentThread) {
		const messages: any[] = [];
		const rolePlay =
			"我希望你能扮演一个创作经验丰富、擅长各种类型文本的作家，尤其善于用浅显易懂的文字解释清楚复杂的概念。我会给你一些我写的草稿文本，请根据我提的要求，对草稿文本进行相应的调整和优化。请尽量让文本简洁明了，优美流畅，让读者在轻松阅读的同时又能获取到明确的信息。非常重要的是，不需要做什么解释，请直接给我你调整和优化后的文本即可。如果文本中涉及到特定的格式，请以 Markdown 格式回答。";
		const codeBlock = await getCommentThreadCode(thread);

		messages.push({"role": "system", "content": rolePlay});

		const filteredComments = thread.comments.filter(comment => comment.label !== "NOTE");

		for (let i = Math.max(0, filteredComments.length - 8); i < filteredComments.length; i++) {
			if (filteredComments[i].author.name === "Libukai 👨‍💻‍") {
				messages.push({"role": "user", "content": `${(filteredComments[i].body as vscode.MarkdownString).value}`});
			} else if (filteredComments[i].author.name === "Aikebang 🧠") {
				messages.push({"role": "assistant", "content": `${(filteredComments[i].body as vscode.MarkdownString).value}`});
			}
		}
		messages.push({"role": "user", "content": `${question}` + codeBlock});

		return messages;
	}


	/**
	 * User replies with a question.
	 * The question + conversation history + code block then gets used
	 * as input to call the OpenAI API to get a response.
	 * The new human question and AI response then gets added to the thread.
	 * @param reply
	 */
	async function askAI(reply: vscode.CommentReply) {
		const question = reply.text.trim();
		const thread = reply.thread;
		const model = vscode.workspace.getConfiguration('scribeai').get('models') + "";
		const OpenAIPrompt = await generatePromptOpenAI(question, thread);
		const humanComment = new NoteComment(new vscode.MarkdownString(question), vscode.CommentMode.Preview, {name: 'Libukai 👨‍💻‍', iconPath: vscode.Uri.parse("https://img.icons8.com/fluency/96/null/user-male-circle.png")}, thread, thread.comments.length ? 'canDelete' : undefined);
		thread.comments = [...thread.comments, humanComment];

		// If openai is not initialized it with existing API Key
		// or doesn't exist then ask user to input API Key.
		if (openai === undefined) {
			if (vscode.workspace.getConfiguration('scribeai').get('ApiKey') === '') {
				const apiKey = await showInputBox();
			}
			const openai = new OpenAI({
				apiKey: vscode.workspace.getConfiguration('scribeai').get('ApiKey'),
			});
		}

		async function chatCompletions() {
			const params = {
				model: model,
				messages: OpenAIPrompt,
			};
			return openai.chat.completions.create(params);
		}

		const response = await chatCompletions();	// If chatCompletion is undefined then ask user to input API Key.

		const responseText = response.choices[0].message?.content ? response.choices[0].message?.content : 'An error occurred. Please try again...';
		const AIComment = new NoteComment(new vscode.MarkdownString(responseText.trim()), vscode.CommentMode.Preview, {name: 'Aikebang 🧠', iconPath: vscode.Uri.parse("https://img.icons8.com/fluency/96/null/chatbot.png")}, thread, thread.comments.length ? 'canDelete' : undefined);
		thread.comments = [...thread.comments, AIComment];

		return responseText;
	}

	/**
	 * AI will edit the highlighted code based on the given instructions.
	 * Uses the OpenAI Edits endpoint. Replaces the highlighted code
	 * with AI generated code. You can undo to go back.
	 *
	 * @param reply
	 * @returns
	 */
	async function aiEdit(reply: vscode.CommentReply) {
		const thread = reply.thread;
		const responseText = await askAI(reply); // Add 'await' here

		if (responseText !== 'An error occurred. Please try again...') {
			const editor = await vscode.window.showTextDocument(thread.uri);
			if (!editor) {
				return; // No open text editor
			}
			editor.edit(editBuilder => {
				editBuilder.replace(thread.range, responseText + "");
			});
		} else {
			vscode.window.showErrorMessage('An error occurred. Please try again...');
		}
	}

	/**
	 * Adds a regular note. Doesn't call OpenAI API.
	 * @param reply
	 */
	function replyNote(reply: vscode.CommentReply) {
		const thread = reply.thread;
		const newComment = new NoteComment(new vscode.MarkdownString(reply.text), vscode.CommentMode.Preview, {name: 'Libukai 👨‍💻', iconPath: vscode.Uri.parse("https://img.icons8.com/fluency/96/null/user-male-circle.png")}, thread, thread.comments.length ? 'canDelete' : undefined);
		newComment.label = 'NOTE';
		thread.comments = [...thread.comments, newComment];
	}
}
