#!/usr/bin/env node

const fs = require( 'fs' )
const path = require( 'path' )

const nfzf = require( 'node-fzf' )

const argv = require( 'minimist' )( process.argv.slice( 2 ) )

if ( argv.h || argv.help ) {
  printHelpText()
  return process.exit( 0 )
}

function printHelpText () {
  const helpText = fs.readFileSync( path.join( __dirname, 'help.txt' ), 'utf8' )
  console.log( helpText )
}

const list = [
  'create electron quickstart file',
  'create node CLI electron starter',
  'help',
  'exit',
]

const opts = {
  mode: 'normal', // start in normal mode
  list: list,
  label: 'Choose option: '
}

main()
async function main () {
  const r = await nfzf( opts )

  if ( !r.selected ) {
    console.log( 'nothing selected, exiting.' )
    return process.exit( 1 )
  }

  switch ( r.selected.index ) {
    case 0:
      console.log( 'TODO create electron quickstart file' )
      return

    case 1:
      console.log( 'TODO create node CLI electron starter' )
      return

    case 2:
      printHelpText()
      return process.exit( 1 )

    case 4:
      console.log( 'exiting.' )
      return process.exit( 1 )
  }
}
