package app

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestAssistantContextTokenCount(test *testing.T) {
	if count := assistantContextTokenCount("Hello, world!"); count != 4 {
		test.Fatalf("expected four text tokens, got %d", count)
	}
	image := map[string]any{"type": "input_image", "image_url": "data:image/png;base64," + strings.Repeat("a", 32768)}
	if assistantContextTokenCount(image) != assistantContextImageTokens {
		test.Fatal("image data was counted as text")
	}
	reasoning := map[string]any{"type": "reasoning", "summary": []map[string]any{{"type": "summary_text", "text": "保留可见摘要"}}}
	reasoningCount := assistantContextTokenCount(reasoning)
	reasoning["encrypted_content"] = strings.Repeat("a", 32768)
	if assistantContextTokenCount(reasoning) != reasoningCount || reasoningCount <= assistantContextTokenCount(map[string]any{"type": "reasoning"}) {
		test.Fatal("reasoning estimate should include visible summaries but not encrypted content")
	}
	arguments := `{"title":"场景提示","prompt":"` + strings.Repeat("请细化镜头与连续性", 128) + `"}`
	function := map[string]any{"name": "project_save", "arguments": arguments}
	chat := map[string]any{"role": "assistant", "tool_calls": []map[string]any{{"type": "function", "id": "call", "function": function}}}
	responses := map[string]any{"role": "assistant", "responseItems": []map[string]any{{"type": "function_call", "call_id": "call", "name": "project_save", "arguments": arguments}, reasoning}}
	chatCount, responsesCount := assistantContextTokenCount(chat), assistantContextTokenCount(responses)
	chat["responseItems"] = responses["responseItems"]
	if assistantContextTokenCount(chat) != max(chatCount, responsesCount) || chatCount < assistantContextTokenCount(arguments) {
		test.Fatal("tool arguments should count without adding duplicate protocol representations")
	}
}

func TestAssistantContextTextChunksPreserveUnicodeAndBudget(test *testing.T) {
	value := strings.Repeat("连续镜头 👩🏽‍🎨 e\u0301\n", 200) + strings.Repeat("片", 1536) + "\n尾"
	for _, budget := range []int{23, 750} {
		chunks := assistantContextTextChunks(value, budget)
		if len(chunks) < 2 || strings.Join(chunks, "") != value {
			test.Fatalf("text lost while splitting at budget %d", budget)
		}
		for _, chunk := range chunks {
			if !utf8.ValidString(chunk) || assistantContextTokenCount(chunk) > budget {
				test.Fatalf("invalid or oversized chunk at budget %d", budget)
			}
		}
	}
}
