.DEFAULT_GOAL := build

NODE_MODULES_STAMP := node_modules/.package-lock.json
APP_NAME := AI Terminal
APP_BUNDLE := dist/mac-arm64/$(APP_NAME).app
INSTALL_DIR ?= /Applications
INSTALL_BUNDLE := $(INSTALL_DIR)/$(APP_NAME).app

export COPYFILE_DISABLE := 1

.PHONY: build clean install

$(NODE_MODULES_STAMP): package-lock.json
	npm ci

build: $(NODE_MODULES_STAMP)
	npm run package:mac

install: build
	test -d "$(APP_BUNDLE)"
	rm -rf "$(INSTALL_BUNDLE)"
	ditto "$(APP_BUNDLE)" "$(INSTALL_BUNDLE)"
	@echo "Installed $(APP_NAME) to $(INSTALL_BUNDLE)"

clean:
	rm -rf out dist
