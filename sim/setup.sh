#!/usr/bin/env bash
# Builds jCardSim from source (needs git, JDK 17, Maven).
set -e
cd "$(dirname "$0")"
mkdir -p lib
[ -d ../applet/sdks ] || git clone --depth 1 https://github.com/martinpaljak/oracle_javacard_sdks ../applet/sdks
[ -d jcardsim-src ] || git clone --depth 1 https://github.com/licel/jcardsim jcardsim-src
cd jcardsim-src
export JC_CLASSIC_HOME="$(cd ../../applet/sdks/jc305u4_kit && pwd)"
mvn -q initialize
mvn -q -DskipTests clean package
cp target/jcardsim-*.jar ../lib/jcardsim.jar 2>/dev/null || cp $(ls target/*.jar | grep -v sources | grep -v javadoc | head -1) ../lib/jcardsim.jar
mvn -q dependency:copy-dependencies -DincludeScope=runtime -DoutputDirectory=../lib
echo "OK: sim/lib/jcardsim.jar"
