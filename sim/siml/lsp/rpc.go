package lsp

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/textproto"
	"strconv"
	"sync"
)

// JSON-RPC 2.0 over a stream, framed as the language server protocol frames it: a Content-Length header, a blank
// line and the body.

const (
	codeParseError       = -32700
	codeInvalidRequest   = -32600
	codeMethodNotFound   = -32601
	codeInvalidParams    = -32602
	codeInternalError    = -32603
	codeRequestCancelled = -32800
	codeContentModified  = -32801
	codeRequestFailed    = -32803
)

type message struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *ResponseError  `json:"error,omitempty"`
}

// An error a request answers with.
type ResponseError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *ResponseError) Error() string { return e.Message }

func failed(format string, args ...any) *ResponseError {
	return &ResponseError{Code: codeRequestFailed, Message: fmt.Sprintf(format, args...)}
}

func invalidParams(err error) *ResponseError {
	return &ResponseError{Code: codeInvalidParams, Message: err.Error()}
}

type frameReader struct{ r *textproto.Reader }

func newFrameReader(in io.Reader) *frameReader {
	return &frameReader{textproto.NewReader(bufio.NewReaderSize(in, 1<<16))}
}

const maxFrame = 64 << 20

// The body of the next frame; io.EOF when the stream ends between frames.
func (f *frameReader) read() ([]byte, error) {
	header, err := f.r.ReadMIMEHeader()
	if err != nil {
		if len(header) == 0 && (err == io.EOF || err == io.ErrUnexpectedEOF) {
			return nil, io.EOF
		}
		return nil, err
	}
	length, err := strconv.Atoi(header.Get("Content-Length"))
	if err != nil || length < 0 {
		return nil, fmt.Errorf("a frame without a Content-Length: %v", header)
	}
	if length > maxFrame {
		return nil, fmt.Errorf("a frame of %d bytes, over the %d MB the server reads", length, maxFrame>>20)
	}
	body := make([]byte, length)
	if _, err := io.ReadFull(f.r.R, body); err != nil {
		return nil, err
	}
	return body, nil
}

// Writes whole frames, one at a time, from any goroutine.
type frameWriter struct {
	mu  sync.Mutex
	out io.Writer
}

func (w *frameWriter) write(msg message) {
	msg.JSONRPC = "2.0"
	body, err := json.Marshal(msg)
	if err != nil {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	fmt.Fprintf(w.out, "Content-Length: %d\r\n\r\n%s", len(body), body)
}

func (w *frameWriter) respond(id json.RawMessage, result any, rpcErr *ResponseError) {
	msg := message{ID: id, Error: rpcErr}
	if rpcErr == nil {
		encoded, err := json.Marshal(result)
		if err != nil {
			msg.Error = &ResponseError{Code: codeInternalError, Message: err.Error()}
		} else {
			msg.Result = encoded
		}
	}
	w.write(msg)
}

func (w *frameWriter) notify(method string, params any) {
	encoded, err := json.Marshal(params)
	if err != nil {
		return
	}
	w.write(message{Method: method, Params: encoded})
}

// A request from the server to the client, whose answer the server does not wait for.
func (w *frameWriter) request(id int, method string, params any) {
	encoded, err := json.Marshal(params)
	if err != nil {
		return
	}
	w.write(message{ID: json.RawMessage(strconv.Itoa(id)), Method: method, Params: encoded})
}
