default: test

test:
    node --test 'test/**/*.test.js'

build:
    node scripts/build.js

check: test
