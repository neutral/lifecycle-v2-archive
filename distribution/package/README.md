# Lifecycle launcher

This directory contains the source for the `@neutral/lifecycle` launcher. The
launcher validates an exact Distribution Manifest, selects digest-qualified
Runtime and Execution Images, and forwards the canonical Lifecycle command
boundary.

The host launcher preserves Runtime arguments, streams, signals, and exit
status. Image acquisition is explicit through `lifecycle setup`, and
`lifecycle doctor` verifies the installed selection.

Registry installation details are published with the corresponding package
and images. Source setup and product documentation are available from the
[Lifecycle repository](https://github.com/neutral/lifecycle).
