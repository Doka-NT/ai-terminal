.DEFAULT_GOAL := build

NODE_MODULES_STAMP := node_modules/.package-lock.json
export COPYFILE_DISABLE := 1

.PHONY: build clean

$(NODE_MODULES_STAMP): package-lock.json
	npm ci

build: $(NODE_MODULES_STAMP)
	npm run package:mac

clean:
	rm -rf out dist
