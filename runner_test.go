package main

import "testing"

func TestFormatAgentLine(t *testing.T) {
	cases := []struct {
		in   string
		want string
		show bool
	}{
		{`{"type":"system","subtype":"init","session_id":"x"}`, "agent session started", true},
		{`{"type":"system","subtype":"other"}`, "", false},
		{`{"type":"assistant","message":{"content":[{"type":"text","text":"Reading the issue."}]}}`, "Reading the issue.", true},
		{`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__yesod__add_comment","input":{}}]}}`, "→ mcp__yesod__add_comment", true},
		{`{"type":"assistant","message":{"content":[{"type":"text","text":"ok"},{"type":"tool_use","name":"get_issue"}]}}`, "ok\n→ get_issue", true},
		{`{"type":"user","message":{"content":[{"type":"tool_result"}]}}`, "", false},
		{`{"type":"result","subtype":"success","result":"Posted a comment."}`, "Posted a comment.", true},
		{"plain CLI output", "plain CLI output", true},
		{"   ", "   ", false},
		{"{not json", "{not json", true},
	}
	for _, c := range cases {
		got, show := formatAgentLine(c.in)
		if got != c.want || show != c.show {
			t.Errorf("formatAgentLine(%q) = (%q, %v), want (%q, %v)", c.in, got, show, c.want, c.show)
		}
	}
}
