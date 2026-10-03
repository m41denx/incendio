package main

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParseLoopSize(t *testing.T) {
	for in, want := range map[string]uint64{"": 0, "50GiB": 50, "50G": 50, "1TiB": 1024, " 8GiB ": 8} {
		got, err := parseLoopSize(in)
		require.NoError(t, err, in)
		require.Equal(t, want, got, in)
	}

	_, err := parseLoopSize("1GiB")
	require.Error(t, err)
	_, err = parseLoopSize("lots")
	require.Error(t, err)

	require.Equal(t, "loop,50G,1", cephLoopSpec(50))
	require.True(t, isLoopSpec("loop,50G,1"))
	require.False(t, isLoopSpec("/dev/sdb"))
}
