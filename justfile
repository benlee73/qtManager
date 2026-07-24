set shell := ["zsh", "-cu"]

# 코드가 생기면 각 언어의 formatter를 이 recipe에 연결한다.
format:
    @echo "No source formatter configured yet."

# 현재는 문서와 비밀정보 유입을 검사한다. 구현 시 Rust/TypeScript lint를 추가한다.
lint:
    @test -s AGENTS.md
    @test -s PROJECT_SPEC.md
    @rg -q 'PROJECT_SPEC\.md' AGENTS.md
    @if rg -q --hidden --glob '!.git/**' --glob '!.idea/**' 'ghp_[A-Za-z0-9]+' .; then echo "Potential GitHub token found in tracked workspace files."; exit 1; fi

# 현재 프로젝트 산출물인 기준 문서의 계약을 검증한다.
test:
    @python3 -c 'import pathlib,re; s=pathlib.Path("PROJECT_SPEC.md").read_text(); ids=re.findall(r"\*\*(FR-[A-Z]+-\d+)\*\*",s); duplicates=sorted({x for x in ids if ids.count(x)>1}); assert not duplicates, f"Duplicate requirement IDs: {duplicates}"; required=["## 7. 기능 요구사항","## 12. 테스트 요구사항","## 20. 미결정 사항","## 21. 결정 기록"]; missing=[x for x in required if x not in s]; assert not missing, f"Missing sections: {missing}"; print(f"Verified {len(ids)} unique requirement IDs.")'

# 애플리케이션 구현 후 실제 데스크톱 E2E 명령으로 교체한다.
e2e:
    @echo "No application E2E suite configured yet."

check: lint test
