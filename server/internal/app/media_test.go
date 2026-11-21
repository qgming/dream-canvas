package app

import (
	"errors"
	"strings"
	"testing"
)

func TestVoiceSampleFormatRequiresRealAllowedAudio(test *testing.T) {
	application := assetFileTestApp(test)
	control := parameterControl{Key: "voice_sample", Label: "音色样本", Type: "asset", Role: "audio", MimeTypes: []string{"audio/mpeg", "audio/wav"}}
	snapshot := executionSnapshot{Model: ChannelModel{Parameters: encode([]parameterControl{control})}}
	for _, mimeType := range []string{"audio/wav", "audio/webm"} {
		test.Run(mimeType, func(test *testing.T) {
			asset := Asset{ID: identifier(), UserID: "owner", Kind: "audio", Title: "recording.wav", MimeType: mimeType, SaveState: "saved", Metadata: JSON(`{}`)}
			if err := application.db.Create(&asset).Error; err != nil { test.Fatal(err) }
			input := generationInput{Parameters: encode(map[string]any{"voice_sample": asset.ID}), References: []assetInput{{AssetID: asset.ID, Role: "audio"}}}
			err := application.validateReferenceMedia(snapshot, input, "owner")
			if mimeType == "audio/wav" { if err != nil { test.Fatal(err) }; return }
			var failure *Problem
			if !errors.As(err, &failure) || failure.Code != "invalid_reference_media" { test.Fatalf("WebM voice sample was not rejected: %v", err) }
			for _, expected := range []string{"音色样本", "audio/webm", "audio/mpeg", "audio/wav"} { if !strings.Contains(failure.Message, expected) { test.Fatalf("missing actual or required audio format %q: %s", expected, failure.Message) } }
		})
	}
}
