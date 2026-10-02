---
title: "FilterChainProxy 源码分析"
date: 2019-07-01
updated: 2026-10-02
tags:
  - Spring
  - Spring-Security
  - Spring-Security过滤流程
domain: Spring
---

FilterChainProxy 先通过 HttpFirewall 检查并包装请求，再按配置顺序选择第一条匹配的 SecurityFilterChain，只执行该链中的过滤器，最后衔接原 Servlet 过滤器链。多条匹配链不会自动叠加，所以链的匹配范围与顺序是实际安全行为的一部分。

本文分析 Servlet 的链选择与 VirtualFilterChain 调用过程。链内过滤器各自负责认证、上下文或授权，FilterChainProxy 主要负责选择与调度；请求没有匹配链时也需要结合整体配置检查实际保护范围。

以下分析基于 Spring Boot 2.1.5.RELEASE 与 Spring Security 5.1.5.RELEASE，源码可对照对应版本的[官方实现](https://github.com/spring-projects/spring-security/blob/5.1.5.RELEASE/web/src/main/java/org/springframework/security/web/FilterChainProxy.java)。

## 概述

启动时构建出的 springSecurityFilterChain Bean 是 FilterChainProxy。请求进入 Servlet 容器后，代理需要先找到匹配的安全链，再逐个调用链上的过滤器；下面分析链选择与 VirtualFilterChain 的调用过程。


## FilterChainProxy

```java
public class FilterChainProxy extends GenericFilterBean {

	private static final Log logger = LogFactory.getLog(FilterChainProxy.class);
	// 过滤器是否执行过的标记
	private final static String FILTER_APPLIED = FilterChainProxy.class.getName().concat(
			".APPLIED");
    // 一系列的过滤链
	private List<SecurityFilterChain> filterChains;
    // 过滤链验证器，默认为空
	private FilterChainValidator filterChainValidator = new NullFilterChainValidator();
    // http防火墙，主要的作用是拒绝一些潜在的危险的请求
	private HttpFirewall firewall = new StrictHttpFirewall();

	public FilterChainProxy() {
	}

	public FilterChainProxy(SecurityFilterChain chain) {
		this(Arrays.asList(chain));
	}

	public FilterChainProxy(List<SecurityFilterChain> filterChains) {
		this.filterChains = filterChains;
	}

	@Override
	public void afterPropertiesSet() {
		filterChainValidator.validate(this);
	}
    // 过滤逻辑
	@Override
	public void doFilter(ServletRequest request, ServletResponse response,
			FilterChain chain) throws IOException, ServletException {
        // 是否清空上下文（是否执行过该过滤器）
		boolean clearContext = request.getAttribute(FILTER_APPLIED) == null;
        // 没有执行过该过滤器
		if (clearContext) {
			try {
                // 设置执行过的标记
				request.setAttribute(FILTER_APPLIED, Boolean.TRUE);
                // 执行过滤逻辑
				doFilterInternal(request, response, chain);
			}
			finally {
                // 清空安全上下文
				SecurityContextHolder.clearContext();
                // 移除执行过的标记
				request.removeAttribute(FILTER_APPLIED);
			}
		}
		else {
            // 执行过滤逻辑
			doFilterInternal(request, response, chain);
		}
	}

	private void doFilterInternal(ServletRequest request, ServletResponse response,
			FilterChain chain) throws IOException, ServletException {
		// 校验请求然后封装成一个FirewalledRequest
		FirewalledRequest fwRequest = firewall
				.getFirewalledRequest((HttpServletRequest) request);
        // 校验响应然后封装成一个HttpServletResponse
		HttpServletResponse fwResponse = firewall
				.getFirewalledResponse((HttpServletResponse) response);
		// 根据请求找到匹配的过滤器，注意只返回第一个匹配请求的过滤器链
		List<Filter> filters = getFilters(fwRequest);

		if (filters == null || filters.size() == 0) {
			if (logger.isDebugEnabled()) {
				logger.debug(UrlUtils.buildRequestUrl(fwRequest)
						+ (filters == null ? " has no matching filters"
								: " has an empty filter list"));
			}

			fwRequest.reset();

			chain.doFilter(fwRequest, fwResponse);

			return;
		}
		// 将FirewalledRequest，FilterChain和filters包装成一个VirtualFilterChain
		VirtualFilterChain vfc = new VirtualFilterChain(fwRequest, chain, filters);
        // 开始执行过滤逻辑
		vfc.doFilter(fwRequest, fwResponse);
	}

	// 只返回第一个匹配请求的过滤器链
	private List<Filter> getFilters(HttpServletRequest request) {
		for (SecurityFilterChain chain : filterChains) {
			if (chain.matches(request)) {
				return chain.getFilters();
			}
		}

		return null;
	}

	public List<Filter> getFilters(String url) {
		return getFilters(firewall.getFirewalledRequest((new FilterInvocation(url, "GET")
				.getRequest())));
	}

	public List<SecurityFilterChain> getFilterChains() {
		return Collections.unmodifiableList(filterChains);
	}

	public void setFilterChainValidator(FilterChainValidator filterChainValidator) {
		this.filterChainValidator = filterChainValidator;
	}

	public void setFirewall(HttpFirewall firewall) {
		this.firewall = firewall;
	}

	@Override
	public String toString() {
		StringBuilder sb = new StringBuilder();
		sb.append("FilterChainProxy[");
		sb.append("Filter Chains: ");
		sb.append(filterChains);
		sb.append("]");

		return sb.toString();
	}

	// 将匹配的请求的过滤链中所有过滤器对请求进行过滤
	private static class VirtualFilterChain implements FilterChain {
        // 原始过滤链
		private final FilterChain originalChain;
        // 配置的所有过滤器
		private final List<Filter> additionalFilters;
        // 请求
		private final FirewalledRequest firewalledRequest;
        // 过滤器链的长度
		private final int size;
        // 当前执行的位置（第几个过滤器在执行）
		private int currentPosition = 0;

		private VirtualFilterChain(FirewalledRequest firewalledRequest,
				FilterChain chain, List<Filter> additionalFilters) {
			this.originalChain = chain;
			this.additionalFilters = additionalFilters;
			this.size = additionalFilters.size();
			this.firewalledRequest = firewalledRequest;
		}
		// 核心过滤逻辑
		@Override
		public void doFilter(ServletRequest request, ServletResponse response)
				throws IOException, ServletException {
            // 如果已经过滤到尾部过滤器，原始过滤链开始过滤
			if (currentPosition == size) {
				if (logger.isDebugEnabled()) {
					logger.debug(UrlUtils.buildRequestUrl(firewalledRequest)
							+ " reached end of additional filter chain; proceeding with original chain");
				}

				// Deactivate path stripping as we exit the security filter chain
				this.firewalledRequest.reset();

				originalChain.doFilter(request, response);
			}
			else {
                // 当前过滤的位置加一
				currentPosition++;
				// 获取当前位置的过滤器
				Filter nextFilter = additionalFilters.get(currentPosition - 1);

				if (logger.isDebugEnabled()) {
					logger.debug(UrlUtils.buildRequestUrl(firewalledRequest)
							+ " at position " + currentPosition + " of " + size
							+ " in additional filter chain; firing Filter: '"
							+ nextFilter.getClass().getSimpleName() + "'");
				}
				// 过滤器开始过滤
				nextFilter.doFilter(request, response, this);
			}
		}
	}

	public interface FilterChainValidator {
		void validate(FilterChainProxy filterChainProxy);
	}

	private static class NullFilterChainValidator implements FilterChainValidator {
		@Override
		public void validate(FilterChainProxy filterChainProxy) {
		}
	}

}
```

## 总结

1. 对请求和响应进行安全检查，并返回对应的包装类
2. 根据请求找到**第一个匹配的SecurityFilterChain**，然后返回SecurityFilterChain包含的所有过滤器
3. 将请求，原始过滤链以及上一步返回的过滤器包装成一个VirtualFilterChain，挨个执行这些过滤器

## 资料来源

- [Spring Boot 2.1.5.RELEASE 依赖版本表](https://docs.spring.io/spring-boot/docs/2.1.5.RELEASE/reference/html/appendix-dependency-versions.html)
- [Spring Security 5.1.5.RELEASE 参考文档](https://docs.spring.io/spring-security/site/docs/5.1.5.RELEASE/reference/htmlsingle/)
