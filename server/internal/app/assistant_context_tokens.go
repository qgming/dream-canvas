package app

import (
	"encoding/json"
	"sync"
	"unicode/utf8"

	"github.com/tiktoken-go/tokenizer/codec"
)

const (
	assistantContextTokenizerWindowBytes = 512
	assistantContextImageTokens          = 1_500
)

var assistantContextCodec = sync.OnceValue(codec.NewCl100kBase)

func assistantContextTokenCount(value any) int {
	switch value := value.(type) {
	case nil:
		return 0
	case string:
		return assistantContextTextTokens(value)
	case map[string]any:
		return assistantContextObjectTokens(value)
	case []map[string]any:
		total := 2
		for _, item := range value {
			total += assistantContextObjectTokens(item) + 1
		}
		return total
	case []any:
		total := 2
		for _, item := range value {
			total += assistantContextTokenCount(item) + 1
		}
		return total
	default:
		encoded, _ := json.Marshal(value)
		return assistantContextTextTokens(string(encoded))
	}
}

func assistantContextObjectTokens(value map[string]any) int {
	kind, _ := value["type"].(string)
	switch kind {
	case "image_asset", "image_url", "input_image":
		return assistantContextImageTokens
	}
	role, _ := value["role"].(string)
	total, chat, responses := 2, 0, 0
	for name, item := range value {
		if kind == "reasoning" && (name == "encrypted_content" || name == "signature") {
			continue
		}
		count := assistantContextTextTokens(name) + assistantContextTokenCount(item) + 2
		switch {
		case role == "assistant" && name == "responseItems":
			responses = count
		case role == "assistant" && (name == "tool_calls" || name == "reasoning_content"):
			chat += count
		default:
			total += count
		}
	}
	return total + max(chat, responses)
}

func assistantContextTextTokens(value string) int {
	total := 0
	for len(value) > 0 {
		width := assistantContextWindowEnd(value, assistantContextTokenizerWindowBytes)
		total += assistantContextWindowTokens(value[:width])
		value = value[width:]
	}
	return total
}

func assistantContextWindowEnd(value string, limit int) int {
	end := min(len(value), limit)
	for end > 0 && end < len(value) && !utf8.RuneStart(value[end]) {
		end--
	}
	if end == 0 {
		_, end = utf8.DecodeRuneInString(value)
	}
	return end
}

func assistantContextWindowTokens(value string) int {
	count, err := assistantContextCodec().Count(value)
	if err != nil {
		return len(value)
	}
	return count
}

func assistantContextTextChunks(value string, budget int) []string {
	if budget <= 0 {
		return nil
	}
	var chunks []string
	start, offset, tokens := 0, 0, 0
	for offset < len(value) {
		width := assistantContextWindowEnd(value[offset:], assistantContextTokenizerWindowBytes)
		count := assistantContextWindowTokens(value[offset : offset+width])
		if offset > start && tokens+count > budget {
			chunks = append(chunks, value[start:offset])
			start, tokens = offset, 0
		}
		if count > budget {
			for count > budget {
				smaller := assistantContextWindowEnd(value[offset:offset+width], width/2)
				if smaller == width {
					return nil
				}
				width = smaller
				count = assistantContextWindowTokens(value[offset : offset+width])
			}
			chunks = append(chunks, value[offset:offset+width])
			offset += width
			start = offset
			continue
		}
		offset += width
		tokens += count
	}
	if offset > start {
		chunks = append(chunks, value[start:offset])
	}
	return chunks
}
