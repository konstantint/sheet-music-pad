.PHONY: all install build clean deploy

all: build

install:
	npm install

build: install
	npm run build

deploy: build
	npm run deploy

clean:
	rm -rf dist node_modules
